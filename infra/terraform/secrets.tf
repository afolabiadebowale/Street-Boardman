# TASK-033: every secret lives in AWS Secrets Manager, encrypted with the
# project KMS key, and ECS injects them into containers as environment
# variables at start. The app reads them exactly as it reads .env locally,
# so no application code changed. Nothing secret is ever typed into a
# tfvars file or a GitHub setting.
#
# Generated values are in Terraform state too, so the state bucket must stay
# encrypted and access-restricted (it is: see ../bootstrap).

resource "random_password" "jwt" {
  for_each = toset(["access", "refresh", "mfa-challenge"])
  length   = 64
  special  = false
}

# Real provider credentials are pasted in by hand (docs/DEPLOYMENT.md);
# Terraform only creates the slot. The placeholder is random rather than
# empty or "CHANGE_ME": nobody can sign a webhook with a value nobody knows.
resource "random_password" "placeholder" {
  for_each = toset(["paystack-secret-key", "paystack-webhook-secret"])
  length   = 48
  special  = false
}

locals {
  generated_secrets = {
    "jwt-access-secret"        = random_password.jwt["access"].result
    "jwt-refresh-secret"       = random_password.jwt["refresh"].result
    "jwt-mfa-challenge-secret" = random_password.jwt["mfa-challenge"].result
    "database-url-owner"       = local.db_owner_url
    "database-url-app"         = local.db_app_url
    "db-app-password"          = random_password.db_app.result
  }
  manual_secrets = {
    "paystack-secret-key"     = random_password.placeholder["paystack-secret-key"].result
    "paystack-webhook-secret" = random_password.placeholder["paystack-webhook-secret"].result
  }
}

resource "aws_secretsmanager_secret" "app" {
  # checkov:skip=CKV2_AWS_57: rotating JWT secrets signs everyone out and DB passwords need a coordinated redeploy; manual rotation procedure in docs/DEPLOYMENT.md
  for_each                = merge(local.generated_secrets, local.manual_secrets)
  name                    = "${local.name}/${each.key}"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = local.is_prod ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "generated" {
  for_each      = local.generated_secrets
  secret_id     = aws_secretsmanager_secret.app[each.key].id
  secret_string = each.value
}

resource "aws_secretsmanager_secret_version" "manual" {
  for_each      = local.manual_secrets
  secret_id     = aws_secretsmanager_secret.app[each.key].id
  secret_string = each.value

  # Once someone pastes the real key in, Terraform must never overwrite it.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

locals {
  secret_arn = { for k, s in aws_secretsmanager_secret.app : k => s.arn }

  # What the API and worker receive. They only ever get the restricted
  # database role (TASK-034); the owner URL goes to the migrate task alone.
  app_container_secrets = [
    { name = "JWT_ACCESS_SECRET", valueFrom = local.secret_arn["jwt-access-secret"] },
    { name = "JWT_REFRESH_SECRET", valueFrom = local.secret_arn["jwt-refresh-secret"] },
    { name = "JWT_MFA_CHALLENGE_SECRET", valueFrom = local.secret_arn["jwt-mfa-challenge-secret"] },
    { name = "DATABASE_URL", valueFrom = local.secret_arn["database-url-app"] },
    { name = "APP_DATABASE_URL", valueFrom = local.secret_arn["database-url-app"] },
    { name = "PAYSTACK_SECRET_KEY", valueFrom = local.secret_arn["paystack-secret-key"] },
    { name = "PAYSTACK_WEBHOOK_SECRET", valueFrom = local.secret_arn["paystack-webhook-secret"] },
  ]

  migrate_container_secrets = [
    { name = "DATABASE_URL", valueFrom = local.secret_arn["database-url-owner"] },
    { name = "APP_DB_PASSWORD", valueFrom = local.secret_arn["db-app-password"] },
  ]
}
