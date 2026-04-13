# Dreamina Web Open API 调用说明

## 1. 登录获取站内 Session

```bash
curl -X POST http://127.0.0.1:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"admin","password":"admin123456"}'
```

这里的 `account` 可以填写用户名或邮箱。返回中的 `data.sessionId` 用于后续创建 API Key。

## 2. 创建 API Key

```bash
curl -X POST http://127.0.0.1:3001/api/auth/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: 你的站内Session" \
  -d '{"name":"n8n 调用"}'
```

返回中的 `data.apiKey` **只会出现一次**，请保存好。

## 3. 文生图 / 图生图

### JSON 文生图

```bash
curl -X POST http://127.0.0.1:3001/api/open/generate/image \
  -H "Authorization: Bearer 你的API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":"一只白猫坐在窗边，电影光影",
    "model":"dreamina-image-4.1",
    "ratio":"1:1"
  }'
```

### multipart 图生图

```bash
curl -X POST http://127.0.0.1:3001/api/open/generate/image \
  -H "Authorization: Bearer 你的API_KEY" \
  -F "prompt=把这张图变成电影感海报" \
  -F "model=dreamina-image-4.1" \
  -F "ratio=3:4" \
  -F "files=@/path/to/reference.png"
```

## 4. 文生视频 / 图生视频

```bash
curl -X POST http://127.0.0.1:3001/api/open/generate/video \
  -H "Authorization: Bearer 你的API_KEY" \
  -F "prompt=人物轻微转头并微笑" \
  -F "model=seedance-2.0-fast" \
  -F "ratio=16:9" \
  -F "duration=5" \
  -F "reference_mode=全能参考" \
  -F "files=@/path/to/reference.png"
```

> 默认推荐国际版模型，如 `seedance-2.0-fast`、`seedance-2.0`、`dreamina-video-3.0` 等。

## 5. 查询任务状态

```bash
curl http://127.0.0.1:3001/api/open/tasks/任务ID \
  -H "Authorization: Bearer 你的API_KEY"
```

成功时返回：

```json
{
  "success": true,
  "data": {
    "taskId": "task_xxx",
    "status": "succeeded",
    "output": [
      {
        "url": "https://...",
        "revised_prompt": "...",
        "type": "image"
      }
    ]
  }
}
```

## 6. 可用路由

- `GET /api/open/spec`
- `POST /api/open/generate/image`
- `POST /api/open/generate/video`
- `GET /api/open/tasks/:taskId`
- `GET /api/auth/api-keys`
- `POST /api/auth/api-keys`
- `DELETE /api/auth/api-keys/:id`
