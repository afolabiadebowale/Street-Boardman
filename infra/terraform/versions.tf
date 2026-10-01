terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # One state file per environment, configured at init time:
  #   terraform init -backend-config=envs/dev.backend.hcl
  # The bucket comes from ../bootstrap (see docs/DEPLOYMENT.md).
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "streetboardman"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name       = "streetboardman-${var.environment}"
  is_prod    = var.environment == "prod"
  account_id = data.aws_caller_identity.current.account_id
  # Pinned, not looked up: a lookup can change when AWS adds a zone, and
  # Terraform would then try to move subnets (and the database) on the
  # next apply.
  azs = ["${var.region}a", "${var.region}b"]
}
