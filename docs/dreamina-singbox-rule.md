# 即梦国际 / Dreamina 的 sing-box 分流规则

示例文件：`docs/dreamina-singbox-rule.example.json`

## 用法

- 把里面的 `route.rules` 合并到你的 sing-box 配置里
- `outbound: "proxy"` 请改成你自己的代理出口名  
  例如：`"🇭🇰 节点"`、`"select"`、`"proxy"`

## 规则覆盖的核心域名

这些域名来自当前项目里实际使用到的国际版请求：

- 页面：
  - `dreamina.capcut.com`
- 视频 / 图片接口：
  - `dreamina-api.us.capcut.com`
  - `dreamina-api.capcut.com`
  - `mweb-api-sg.capcut.com`
- 商业 / 积分接口：
  - `commerce.us.capcut.com`
  - `commerce.capcut.com`
  - `commerce-api.capcut.com`
  - `commerce-api-sg.capcut.com`
- 图片上传：
  - `imagex16-normal-us-ttp.capcutapi.us`
  - `imagex-normal-sg.capcutapi.com`
- 静态资源：
  - `capcutcdn.com`
  - `capcutcdn-us.com`

## 建议

如果你是专门给 Dreamina 国际版走代理，这套规则够用了。  
如果后面你发现还有漏网域名，可以继续往 `domain_suffix` 里补。
