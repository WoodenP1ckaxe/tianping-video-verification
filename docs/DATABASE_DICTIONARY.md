# 数据库字典与数据约束

运行数据库为 SQLite，使用 WAL 模式与外键约束。实际表结构是唯一事实来源，可用：

```sql
SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name;
PRAGMA table_info('records');
PRAGMA foreign_key_list('records');
```

## 1. 主要数据实体

| 表 | 主键/唯一键 | 职责 |
| --- | --- | --- |
| `users` | `id` | 账号、姓名、角色、状态、口令散列、失败计数与首次改密；连续 5 次失败锁定 10 分钟 |
| `sessions` | `id` | 服务端会话、CSRF、最后活动与过期时间 |
| `login_rate_limits` | `source_key` | 未知账号按来源 IP 的 5 分钟尝试窗口与短时封禁 |
| `login_captchas` | `token_hash` | 旧版本兼容表；当前登录流程不再创建验证码 |
| `notifications` | 自增主键 | 记录退回、复核、作废和任务失败等定向站内通知 |
| `devices` | `id`、`unique_no` | 天平档案、量程、标称点、容差与设备二维码内容 |
| `weight_boxes` | `id` | 砝码盒字典；与天平不建立物理绑定 |
| `dictionary_items` | `id`、(`category`,`value`) | 科室、内部校正方式、天平编号规则等基础数据字典 |
| `uploads` | `id` | 上传会话、目标偏移、预计天平、SHA-256、临时文件 |
| `tasks` | `id` | FIFO 分析任务、状态、预计/实际天平、耗时、警告、错误与生成记录 |
| `records` | `id` | 校验记录主表、状态、签名；9 次示值存于 `readouts_json`，修改痕迹存于 `modifications_json`，固定判定存于 `judgment_json` |
| `template_versions` | `version` | 不可变模板版本 |
| `audit_logs` | 自增主键 | 只追加审计事件 |
| `exports` | `id` | 导出范围、文件名称、记录条数与结果 |
| `settings` | `key` | 容差阈值、存储配额、保留期限等配置 |
| `backups` | `id` | 手动/自动备份状态与文件 |
| `cleanup_log` | 自增主键 | 容量策略清理的视频文件、时间与原因 |

读数、卡片识别、人工核对、修改痕迹和判定快照以 JSON 文本保存在 `records` 中。
`speech_json` 仅为早期数据库兼容列，新版本不再读写语音识别结果。
JSON 仍由应用层按固定形状校验；每次业务修改同时写入 `audit_logs`。

旧数据库首次由新版本打开时会自动：

- 增加判定快照、上传预计天平、站内通知和登录限流表/列；
- 为已有记录补齐固定判定快照；
- 不修改历史记录的 `updated_at`；
- 对天平档案或历史数据异常无法判定的记录写入“待处理”迁移审计并在运行时降级处理。

## 2. 记录编号与状态

记录编号：

```text
校验日期(YYYYMMDD)-天平编号-当日序号(01..)
```

允许状态和转换：

```text
待提交 ──检验人员提交──> 已提交 ──复核确认──> 已复核确认
   │                         │
   │                         └──复核退回──> 待提交
   ├────────管理员作废──────> 已作废
   └────────管理员作废──────> 已作废
```

非法转换必须在服务端拒绝，不能只依赖前端按钮禁用。

## 3. 分析任务状态

`排队中、分析中、已完成、失败、待人工处理、已取消`。

- 服务启动时遗留 `分析中` 改为 `失败(E-RESTARTED)`；
- `排队中` 不丢失；
- 重试复用任务 ID；
- FIFO 排序为 `queued_at, rowid`；
- 一个任务最多生成一条正式记录。

## 4. 读取与判定字段

- `point`：0..2，对应 L1/L2/L3；
- `idx`：1..3；
- `range`：1 高量程/单量程，2 低量程；
- `value`：十进制示值，单位 g；
- `off`：视频内读数偏移秒数；
- `conf`：0..1；
- `stable`：是否有 ≥3 秒且变化 ≤1 个分度值的平台段；
- `screenshot`：相对数据目录的截图路径；
- `range_transition_json`：双量程切换过程段起止秒数、前后样本数；
- `conclusion / judgment_json / judged_at / rule_version`：固定判定结论、原因、
  明细、判定时间和规则版本；提交、复核、CSV 与 PDF 统一读取该快照；
- 低置信人工核对键值保存在 `checks_json`，同时写审计。

限制条件必须包括：

- 每条记录应包含 9 个 `point + idx` 组合；
- 置信度范围 0..1（应用层校验）；
- 量程 1/2；
- 记录状态值受枚举约束；
- 已复核确认记录禁止更新业务字段；
- `audit_logs_no_update` 和 `audit_logs_no_delete` 触发器阻止审计日志被修改或删除；
  应用层也不提供对应接口。

## 5. 审计字段

审计至少包含：

`time, actor_id, actor_name, role, action, object_type, object_id, before_value,
after_value, reason, source_ip, result`。

不得记录明文口令、Cookie、CSRF token 或完整视频内容。

## 6. 时间与容量

- 数据库时间保存为固定格式；界面和导出均为 `YYYY-MM-DD HH:mm`。
- 业务日期按 `Asia/Shanghai`。
- 记录和审计默认保留 5 年以上。
- 视频按容量配额清理，但记录、截图、PDF 和审计不受影响。

