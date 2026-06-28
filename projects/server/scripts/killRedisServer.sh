#!/bin/bash
# 为了防止 vscode 在因为任何原因直接退出而没有正确关闭 Redis 服务器，导致下次启动时 Redis 端口被占用，无法启动 Redis 服务器。
redis-cli -p 6379 shutdown
