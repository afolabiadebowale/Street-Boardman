# terraform init -backend-config=envs/prod.backend.hcl
bucket       = "streetboardman-tfstate-ACCOUNT_ID" # TODO: from ../bootstrap output
key          = "prod/terraform.tfstate"
region       = "af-south-1"
encrypt      = true
use_lockfile = true # S3-native locking (Terraform 1.10+), no DynamoDB table
