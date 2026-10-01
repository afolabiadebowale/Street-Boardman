# TASK-040: GitHub Actions deploys with short-lived credentials (OIDC) —
# no AWS access keys stored in GitHub. The role can only be assumed by a
# workflow job running in this environment's GitHub Environment, so prod
# deploys inherit that environment's required reviewers.

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_github_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  github_oidc_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

resource "aws_iam_role" "github_deploy" {
  name = "${local.name}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.environment}"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "EcrLogin", Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Sid    = "PushImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage",
        ]
        Resource = [for r in aws_ecr_repository.app : r.arn]
      },
      { Sid = "ImageKey", Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = aws_kms_key.main.arn },
      # Task definitions can't be scoped by ARN for registration.
      { Sid = "TaskDefinitions", Effect = "Allow", Action = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"], Resource = "*" },
      {
        Sid       = "RunMigrations"
        Effect    = "Allow"
        Action    = "ecs:RunTask"
        Resource  = "arn:aws:ecs:${var.region}:${local.account_id}:task-definition/${local.name}-migrate:*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } }
      },
      { Sid = "WatchTasks", Effect = "Allow", Action = "ecs:DescribeTasks", Resource = "arn:aws:ecs:${var.region}:${local.account_id}:task/${aws_ecs_cluster.main.name}/*" },
      {
        Sid      = "RollOut"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = [for s in aws_ecs_service.app : s.id]
      },
      {
        Sid       = "HandRolesToTasks"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = [aws_iam_role.task_execution.arn, aws_iam_role.task.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      { Sid = "MigrationLogs", Effect = "Allow", Action = "logs:GetLogEvents", Resource = "${aws_cloudwatch_log_group.app["migrate"].arn}:*" },
    ]
  })
}
