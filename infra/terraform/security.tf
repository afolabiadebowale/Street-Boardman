# One customer-managed key for everything sensitive at rest: secrets, the
# database, logs, and the alarm topic. Rotated yearly by AWS.
resource "aws_kms_key" "main" {
  description             = "${local.name} application data"
  enable_key_rotation     = true
  deletion_window_in_days = local.is_prod ? 30 : 7

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountAdministers"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CloudWatchLogsEncrypt"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
        Condition = { ArnLike = { "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.region}:${local.account_id}:*" } }
      },
      {
        Sid       = "AlarmsPublishToEncryptedTopic"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = ["kms:Decrypt", "kms:GenerateDataKey*"]
        Resource  = "*"
      },
    ]
  })
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}

resource "aws_security_group" "alb" {
  # checkov:skip=CKV_AWS_260: port 80 only answers with a 301 redirect to HTTPS (aws_lb_listener.http)
  name        = "${local.name}-alb"
  description = "Public HTTPS entry point"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP, redirected to HTTPS"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "To app tasks only"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

# App tasks accept traffic only from the load balancer, even when they have
# public IPs (low-cost mode). Outbound is open: ECR pulls, Paystack, Sentry.
resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "API, worker and web tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "API from load balancer"
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    description     = "Web from load balancer"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    description = "HTTPS out (ECR, Paystack, Sentry)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description     = "Postgres"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.db.id]
  }
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "Postgres, reachable only from app tasks"
  vpc_id      = aws_vpc.main.id
}

# Separate rule resource: app and db groups reference each other.
resource "aws_security_group_rule" "db_from_app" {
  type                     = "ingress"
  description              = "Postgres from app tasks"
  security_group_id        = aws_security_group.db.id
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
}
