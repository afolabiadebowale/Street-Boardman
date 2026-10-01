# Run once per AWS account, with local state, before anything in
# ../terraform. Creates the bucket that holds every environment's
# Terraform state. That state contains generated secrets, so the bucket is
# private, encrypted, versioned (recover from a bad apply), and refuses
# non-TLS access. See docs/DEPLOYMENT.md.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

variable "region" {
  type    = string
  default = "af-south-1"
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "streetboardman", ManagedBy = "terraform", Purpose = "terraform-state" }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "state" {
  description         = "Terraform state for streetboardman"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AccountAdministers"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })
}

resource "aws_s3_bucket" "state" {
  # checkov:skip=CKV_AWS_144: state is versioned; cross-region replication is not worth it at this stage
  # checkov:skip=CKV_AWS_18: access is via IAM and CloudTrail; a separate access-log bucket adds little
  # checkov:skip=CKV2_AWS_62: nothing consumes events from this bucket
  bucket = "streetboardman-tfstate-${data.aws_caller_identity.current.account_id}"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

output "state_bucket" {
  description = "Put this in infra/terraform/envs/*.backend.hcl"
  value       = aws_s3_bucket.state.bucket
}
