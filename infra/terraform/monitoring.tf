# TASK-043: alarms on the business events the app already logs as JSON
# (TASK-041), plus the infrastructure basics. Everything goes to one SNS
# topic; add emails via var.alert_emails (each must confirm once).

resource "aws_sns_topic" "alerts" {
  name              = "${local.name}-alerts"
  kms_master_key_id = aws_kms_key.main.arn
}

resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  metric_namespace = "StreetBoardman/${var.environment}"

  # Log-derived metrics. Patterns match the JSON fields pino writes.
  log_metrics = {
    PayoutRetriesExhausted = { group = "worker", pattern = "{ $.event = \"payout_retries_exhausted\" }" }
    ReconciliationMismatch = { group = "worker", pattern = "{ ($.event = \"daily_reconciliation\") && ($.pass IS FALSE) }" }
    SweepFailed            = { group = "worker", pattern = "{ $.event = \"sweep_failed\" }" }
    WorkerHeartbeat        = { group = "worker", pattern = "{ $.event = \"sweep_tick\" }" }
    AccountLocked          = { group = "api", pattern = "{ $.event = \"account_locked\" }" }
    ApiErrors              = { group = "api", pattern = "{ $.level >= 50 }" }
  }
}

resource "aws_cloudwatch_log_metric_filter" "app" {
  for_each       = local.log_metrics
  name           = "${local.name}-${each.key}"
  log_group_name = aws_cloudwatch_log_group.app[each.value.group].name
  pattern        = each.value.pattern
  metric_transformation {
    name          = each.key
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

locals {
  # threshold / evaluation periods (5-minute periods unless noted) / why
  log_alarms = {
    PayoutRetriesExhausted = { threshold = 1, periods = 1, missing = "notBreaching", what = "Winners are waiting on money: a payout failed 3 times and needs a human." }
    ReconciliationMismatch = { threshold = 1, periods = 1, missing = "notBreaching", what = "A wallet balance disagrees with the double-entry ledger." }
    SweepFailed            = { threshold = 3, periods = 3, missing = "notBreaching", what = "The worker sweep keeps failing: auto-confirm and payouts are stalled." }
    AccountLocked          = { threshold = 20, periods = 3, missing = "notBreaching", what = "Many accounts locked by failed logins: likely a credential-stuffing attack." }
    ApiErrors              = { threshold = 10, periods = 1, missing = "notBreaching", what = "Burst of unhandled API errors." }
  }
}

resource "aws_cloudwatch_metric_alarm" "app" {
  for_each            = local.log_alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.what
  namespace           = local.metric_namespace
  metric_name         = each.key
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = each.value.missing
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# The worker logs a tick every minute. Silence means it's dead or hung,
# and payouts have quietly stopped; missing data counts as breaching.
resource "aws_cloudwatch_metric_alarm" "worker_heartbeat" {
  alarm_name          = "${local.name}-WorkerHeartbeatMissing"
  alarm_description   = "No worker sweep ticks for 10 minutes: the worker is down, so auto-confirm and payouts have stopped."
  namespace           = local.metric_namespace
  metric_name         = "WorkerHeartbeat"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

locals {
  alb_dimensions = { LoadBalancer = aws_lb.main.arn_suffix }
  infra_alarms = {
    Api5xx = {
      what       = "API returning 5xx errors.", namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count",
      dimensions = merge(local.alb_dimensions, { TargetGroup = aws_lb_target_group.api.arn_suffix }),
      statistic  = "Sum", threshold = 10, op = "GreaterThanOrEqualToThreshold", periods = 1
    }
    ApiUnhealthy = {
      what       = "An API task is failing load balancer health checks.", namespace = "AWS/ApplicationELB", metric = "UnHealthyHostCount",
      dimensions = merge(local.alb_dimensions, { TargetGroup = aws_lb_target_group.api.arn_suffix }),
      statistic  = "Maximum", threshold = 1, op = "GreaterThanOrEqualToThreshold", periods = 2
    }
    DbCpu = {
      what       = "Database CPU above 80% for 15 minutes.", namespace = "AWS/RDS", metric = "CPUUtilization",
      dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier },
      statistic  = "Average", threshold = 80, op = "GreaterThanThreshold", periods = 3
    }
    DbStorage = {
      what       = "Database free storage below 2 GiB.", namespace = "AWS/RDS", metric = "FreeStorageSpace",
      dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier },
      statistic  = "Minimum", threshold = 2147483648, op = "LessThanThreshold", periods = 1
    }
    DbConnections = {
      # db.t4g.micro allows roughly 80 connections.
      what       = "Database connections close to the instance limit.", namespace = "AWS/RDS", metric = "DatabaseConnections",
      dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier },
      statistic  = "Maximum", threshold = 60, op = "GreaterThanThreshold", periods = 2
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "infra" {
  for_each            = local.infra_alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.what
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.statistic
  period              = 300
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# p95 latency is an extended statistic, so it can't share the block above.
resource "aws_cloudwatch_metric_alarm" "api_latency" {
  alarm_name          = "${local.name}-ApiLatencyP95"
  alarm_description   = "API p95 latency above 1s for 15 minutes (load-test baseline: ~0.7s at 200 concurrent bettors)."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = merge(local.alb_dimensions, { TargetGroup = aws_lb_target_group.api.arn_suffix })
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title   = "Money and safety events", region = var.region, stat = "Sum", period = 300
          metrics = [for m in ["PayoutRetriesExhausted", "ReconciliationMismatch", "SweepFailed", "AccountLocked"] : [local.metric_namespace, m]]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title   = "Worker heartbeat (ticks per 5 min, expect ~5)", region = var.region, stat = "Sum", period = 300
          metrics = [[local.metric_namespace, "WorkerHeartbeat"]]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 12, height = 6
        properties = {
          title = "API requests and errors", region = var.region, stat = "Sum", period = 60
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.main.arn_suffix],
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", aws_lb.main.arn_suffix],
            ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", aws_lb.main.arn_suffix],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 6, width = 12, height = 6
        properties = {
          title = "API latency (s)", region = var.region, period = 60
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.main.arn_suffix, { stat = "p50" }],
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.main.arn_suffix, { stat = "p95" }],
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.main.arn_suffix, { stat = "p99" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 12, width = 12, height = 6
        properties = {
          title = "Database", region = var.region, stat = "Average", period = 300
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.main.identifier],
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", aws_db_instance.main.identifier],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 12, width = 12, height = 6
        properties = {
          title   = "ECS CPU %", region = var.region, stat = "Average", period = 300
          metrics = [for s in keys(local.long_running) : ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", s]]
        }
      },
    ]
  })
}
