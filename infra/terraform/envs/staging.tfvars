# Mirrors prod's shape at low-cost size, so prod changes are rehearsed here.
environment = "staging"
domain_name = "staging.example.com" # TODO
# route53_zone_id = "Z0123456789ABC"

db_backup_retention_days    = 7
alert_emails                = []    # TODO
create_github_oidc_provider = false # if staging shares an AWS account with dev
