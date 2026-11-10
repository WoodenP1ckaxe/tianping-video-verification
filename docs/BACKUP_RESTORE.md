# 备份与恢复说明

## 1. 备份范围

必须备份：

- SQLite 数据库，包括账号、主数据、记录、读数、修改痕迹、模板和审计；
- 系统配置和上传目录清单；
- 识别截图与正式导出件（可选，但建议）；
- 数据目录路径、应用镜像 tag、Compose 文件和环境变量。

原始视频默认不纳入每日数据库备份，是否另行备份由现场数据保留制度决定。

## 2. 手动备份

管理员页面提供“立即备份”。命令行等价操作：

```bash
node scripts/maintenance.js backup
node scripts/maintenance.js verify
```

PowerShell：

```powershell
.\scripts\backup.ps1
node scripts\maintenance.js verify
```

脚本使用 SQLite `VACUUM INTO` 生成一致性快照，并执行 `PRAGMA integrity_check`。
备份默认位于 `backups/`，文件名为 `tianping-YYYYMMDD-HHmmss.db`。

## 3. 自动备份

应用服务会在每日 `02:00`～`05:59` 之间检查一次，并在当天尚无成功自动备份时
创建数据库备份；服务运行期间每 15 分钟检查一次，不会重复创建同日备份。备份
失败会记录状态并显示在系统运行页面。

如需额外保留站点级备份，Linux cron 示例为每日 02:15：

```cron
15 2 * * * cd /opt/tianping-system && /usr/bin/node scripts/maintenance.js backup >> /var/log/tianping-backup.log 2>&1
```

Windows 任务计划程序：

- 程序：`pwsh.exe`
- 参数：`-NoProfile -File C:\tianping-system\scripts\backup.ps1`
- 起始目录：`C:\tianping-system`
- 运行账户必须对 `data`、`backups` 有读写权限。

保留最近 30 天后可运行：

```bash
node scripts/maintenance.js prune
```

## 4. 恢复步骤

1. 在管理页记录当前版本、时间和问题现象。
2. 停止应用：`docker compose stop tianping`。
3. 将现有 `data/tianping.db` 及其 WAL/SHM 文件移动到
   `data/pre-restore-YYYYMMDD-HHmm/`，不要直接删除。
4. 验证备份：
   `node scripts/maintenance.js verify backups/tianping-....db`。
5. 复制备份为 `data/tianping.db`，保持容器内 `node` 用户可读写。
6. 启动应用并检查 `/healthz`。
7. 用三个角色各登录一次，抽查记录、附件、审计和导出。
8. 记录恢复演练结果；旧文件至少保留到业务确认完成。

如果备份损坏，停止恢复并使用下一份较早备份。禁止在应用运行且 WAL 正在写入时
直接覆盖数据库文件。

## 5. 演练验收

每季度至少一次在非生产副本上演练：

- 从备份成功启动；
- 账号数、记录数、审计数和最近记录编号一致；
- 一条记录可打开视频（若未清理）和 9 张截图；
- 复核状态与签名一致；
- 导出 PDF 可打印。

