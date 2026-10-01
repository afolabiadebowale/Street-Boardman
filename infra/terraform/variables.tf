variable "environment" {
  description = "dev, staging or prod."
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "region" {
  description = "Cape Town: the nearest full AWS region to Nigeria."
  type        = string
  default     = "af-south-1"
}

variable "domain_name" {
  description = "Public hostname for the app, e.g. app.streetboardman.com. HTTPS is mandatory: session cookies are Secure in production."
  type        = string
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone for domain_name. If null, add the certificate validation and app records at your DNS provider by hand (see outputs)."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Sizing. Defaults are the low-cost pilot setup (decision 2026-09-30).
# High availability is a variable change, not a rewrite: see envs/prod.tfvars.
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "use_nat_gateway" {
  description = "false (low-cost): app tasks run in public subnets with public IPs, but only accept traffic from the load balancer. true: tasks move to private subnets behind a NAT gateway (~USD 35+/month)."
  type        = bool
  default     = false
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "web_desired_count" {
  type    = number
  default = 1
}

variable "worker_desired_count" {
  description = "Advisory locks make more than one safe, but one is enough: sweeps are short."
  type        = number
  default     = 1
}

variable "task_cpu" {
  description = "Fargate CPU units per task (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate memory (MiB) per task."
  type        = number
  default     = 512
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_multi_az" {
  description = "Standby in a second AZ with automatic failover. Doubles the database cost. Turn on before real money."
  type        = bool
  default     = false
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling (GiB)."
  type        = number
  default     = 100
}

variable "db_backup_retention_days" {
  description = "Daily snapshots plus point-in-time recovery to any second within this window (TASK-044)."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

variable "enable_waf" {
  description = "AWS WAF on the load balancer (managed common rules + per-IP rate limit). Roughly USD 10/month; recommended before public launch."
  type        = bool
  default     = false
}

variable "enable_container_insights" {
  description = "Per-task CPU/memory/running-count metrics. Extra CloudWatch cost."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# App configuration
# ---------------------------------------------------------------------------

variable "image_tag" {
  description = "Initial image tag. Afterwards the deploy workflow registers new task definitions; Terraform ignores those changes."
  type        = string
  default     = "bootstrap"
}

variable "app_mode" {
  description = "DEMO until the payment-provider and legal work is done (see spec section 15)."
  type        = string
  default     = "DEMO"
  validation {
    condition     = contains(["DEMO", "PRODUCTION"], var.app_mode)
    error_message = "app_mode must be DEMO or PRODUCTION."
  }
}

variable "staff_security_enforced_from" {
  description = "Date (YYYY-MM-DD) from which admin tools require MFA and a 12+ character password. null = enforced immediately."
  type        = string
  default     = null
}

variable "sentry_dsn" {
  description = "Optional. Empty = error tracking off."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "alert_emails" {
  description = "Who gets CloudWatch alarms (TASK-043). Each address must confirm the SNS subscription email."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# GitHub Actions deploys (TASK-040)
# ---------------------------------------------------------------------------

variable "github_repository" {
  type    = string
  default = "afolabiadebowale/Street-Boardman"
}

variable "create_github_oidc_provider" {
  description = "An AWS account can only have one GitHub OIDC provider. Set false for the second and later environments in the same account."
  type        = bool
  default     = true
}
