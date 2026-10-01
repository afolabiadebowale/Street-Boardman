locals {
  services = toset(["api", "worker", "web", "migrate"])
}

resource "aws_ecr_repository" "app" {
  for_each             = local.services
  name                 = "${local.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE" # a tag always means the same image
  force_delete         = !local.is_prod

  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.main.arn
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_ecs_cluster" "main" {
  # checkov:skip=CKV_AWS_65: Container Insights is var.enable_container_insights, off by default for cost
  name = local.name
  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  # checkov:skip=CKV_AWS_338: retention is var.log_retention_days; prod sets 365, dev/staging keep 30 for cost
  for_each          = local.services
  name              = "/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

# Pulls images, writes logs, and reads exactly the secrets the tasks use.
resource "aws_iam_role" "task_execution" {
  name = "${local.name}-task-execution"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  role = aws_iam_role.task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = values(local.secret_arn) },
      { Effect = "Allow", Action = "kms:Decrypt", Resource = aws_kms_key.main.arn },
    ]
  })
}

# What the running code itself may do in AWS: nothing. It talks only to
# Postgres and the internet.
resource "aws_iam_role" "task" {
  name = "${local.name}-task"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

locals {
  app_environment = concat(
    [
      { name = "NODE_ENV", value = "production" },
      { name = "APP_MODE", value = var.app_mode },
      { name = "PORT", value = "4000" },
      { name = "CLIENT_ORIGIN", value = "https://${var.domain_name}" },
      { name = "TRUST_PROXY_HOPS", value = "1" }, # the load balancer
      { name = "LOG_LEVEL", value = "info" },
      { name = "SENTRY_DSN", value = var.sentry_dsn },
      { name = "SENTRY_ENVIRONMENT", value = var.environment },
    ],
    var.staff_security_enforced_from == null ? [] : [
      { name = "STAFF_SECURITY_ENFORCED_FROM", value = var.staff_security_enforced_from },
    ],
  )

  log_config = { for s in local.services : s => {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.app[s].name
      "awslogs-region"        = var.region
      "awslogs-stream-prefix" = s
    }
  } }

  image = { for s in local.services : s => "${aws_ecr_repository.app[s].repository_url}:${var.image_tag}" }

  containers = {
    api = {
      name                   = "api"
      image                  = local.image.api
      essential              = true
      readonlyRootFilesystem = true
      portMappings           = [{ containerPort = 4000, protocol = "tcp" }]
      environment            = local.app_environment
      secrets                = local.app_container_secrets
      logConfiguration       = local.log_config.api
      stopTimeout            = 15
      healthCheck = {
        command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 15
      }
    }
    worker = {
      name                   = "worker"
      image                  = local.image.worker
      essential              = true
      readonlyRootFilesystem = true
      environment            = local.app_environment
      secrets                = local.app_container_secrets
      logConfiguration       = local.log_config.worker
      stopTimeout            = 15
    }
    web = {
      name      = "web"
      image     = local.image.web
      essential = true
      # nginx writes its cache and pid file, so its root stays writable.
      readonlyRootFilesystem = false
      portMappings           = [{ containerPort = 80, protocol = "tcp" }]
      # The load balancer sends /api/* to the API directly; nginx never
      # proxies here. It still needs a resolvable upstream to start.
      environment      = [{ name = "API_UPSTREAM", value = "http://127.0.0.1:4000" }]
      logConfiguration = local.log_config.web
    }
    # One-shot, run by the deploy workflow before services roll out
    # (TASK-040). Owner credentials exist only in this task.
    migrate = {
      name                   = "migrate"
      image                  = local.image.migrate
      essential              = true
      readonlyRootFilesystem = false
      command                = ["sh", "-c", "npx prisma migrate deploy && node scripts/provision-db-roles.js"]
      environment            = [{ name = "NODE_ENV", value = "production" }]
      secrets                = local.migrate_container_secrets
      logConfiguration       = local.log_config.migrate
    }
  }
}

resource "aws_ecs_task_definition" "app" {
  for_each                 = local.services
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions    = jsonencode([local.containers[each.key]])

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
}

locals {
  long_running = {
    api    = { count = var.api_desired_count, target_group = aws_lb_target_group.api.arn, port = 4000 }
    web    = { count = var.web_desired_count, target_group = aws_lb_target_group.web.arn, port = 80 }
    worker = { count = var.worker_desired_count, target_group = null, port = null }
  }
}

resource "aws_ecs_service" "app" {
  for_each        = local.long_running
  name            = each.key
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app[each.key].arn
  desired_count   = each.value.count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.app_subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = local.app_assign_public_ip
  }

  dynamic "load_balancer" {
    for_each = each.value.target_group == null ? [] : [1]
    content {
      target_group_arn = each.value.target_group
      container_name   = each.key
      container_port   = each.value.port
    }
  }

  # A deploy that never becomes healthy rolls itself back.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # The deploy workflow registers new task definitions; Terraform must not
  # roll services back to the revision it created.
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.https]
}
