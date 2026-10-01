resource "random_password" "db_owner" {
  length  = 40
  special = false # used inside connection URLs
}

resource "random_password" "db_app" {
  length  = 40
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "main" {
  name   = local.name
  family = "postgres16"

  # Every connection must use TLS.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # Slow-query visibility for the hot-row contention seen in load tests.
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
  parameter {
    name  = "log_lock_waits"
    value = "1"
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${local.name}-rds-monitoring"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "monitoring.rds.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "main" {
  # checkov:skip=CKV_AWS_157: Multi-AZ is var.db_multi_az, off for the low-cost pilot; envs/prod.tfvars marks it to turn on before real money
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = "streetboardman"
  username = "sbowner"
  password = random_password.db_owner.result

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.main.arn

  multi_az               = var.db_multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.main.name

  # TASK-044: daily snapshots + point-in-time recovery to any second in the
  # retention window. Windows are UTC: 01:00 UTC = 02:00 in Lagos.
  backup_retention_period  = var.db_backup_retention_days
  backup_window            = "01:00-02:00"
  maintenance_window       = "sun:02:30-sun:03:30"
  copy_tags_to_snapshot    = true
  delete_automated_backups = false

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = !local.is_prod
  final_snapshot_identifier = local.is_prod ? "${local.name}-final" : null

  auto_minor_version_upgrade          = true
  iam_database_authentication_enabled = true
  enabled_cloudwatch_logs_exports     = ["postgresql", "upgrade"]
  performance_insights_enabled        = true
  performance_insights_kms_key_id     = aws_kms_key.main.arn
  monitoring_interval                 = 60
  monitoring_role_arn                 = aws_iam_role.rds_monitoring.arn

  # Minor upgrades happen in the maintenance window, so Terraform shouldn't
  # try to "downgrade" the recorded version afterwards.
  lifecycle {
    ignore_changes = [engine_version]
  }
}

locals {
  db_host = aws_db_instance.main.address
  # sslmode=require because rds.force_ssl rejects unencrypted connections.
  db_owner_url = "postgresql://sbowner:${random_password.db_owner.result}@${local.db_host}:5432/streetboardman?schema=public&sslmode=require"
  db_app_url   = "postgresql://streetboardman_app:${random_password.db_app.result}@${local.db_host}:5432/streetboardman?schema=public&sslmode=require"
}
