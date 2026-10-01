output "app_url" {
  value = "https://${var.domain_name}"
}

output "load_balancer_dns" {
  description = "Point domain_name here (CNAME, or ALIAS at the apex) if you're not using Route 53."
  value       = aws_lb.main.dns_name
}

output "acm_validation_records" {
  description = "Without route53_zone_id, add these at your DNS provider so the HTTPS certificate can be issued."
  value = [for o in aws_acm_certificate.app.domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }]
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "dashboard_url" {
  value = "https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}

output "paystack_secret_names" {
  description = "Paste the real Paystack keys into these when moving to APP_MODE=PRODUCTION."
  value       = [aws_secretsmanager_secret.app["paystack-secret-key"].name, aws_secretsmanager_secret.app["paystack-webhook-secret"].name]
}

# Copy into the matching GitHub Environment's variables (docs/DEPLOYMENT.md).
output "github_environment_variables" {
  value = {
    AWS_REGION           = var.region
    AWS_DEPLOY_ROLE_ARN  = aws_iam_role.github_deploy.arn
    ECR_REGISTRY         = split("/", aws_ecr_repository.app["api"].repository_url)[0]
    NAME_PREFIX          = local.name
    ECS_CLUSTER          = aws_ecs_cluster.main.name
    ECS_SUBNETS          = join(",", local.app_subnet_ids)
    ECS_SECURITY_GROUP   = aws_security_group.app.id
    ECS_ASSIGN_PUBLIC_IP = local.app_assign_public_ip ? "ENABLED" : "DISABLED"
  }
}
