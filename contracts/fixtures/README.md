# V1 契约夹具

`failed-bundle/` 是完整、无秘密的合成发布输入，不是实际产品测试结果。
项目、Repository、Campaign 及当前 plan/target 必须先由所有者或明确授权的初始化步骤登记。
本地副本保留固定 UUID 和原始字节；网络重试不能生成另一 Run 或 revision。

报告故意为业务失败、实际构建身份未核实，合法并不表示验收就绪。
资产是合成文本，不能作为真实业务验收证据。
原始文件摘要包含换行和空白，修改文档后必须重新生成清单中的摘要和大小。manifest.json 自身使用 acceptances-jcs-1 字节，不能用普通 pretty-print 改写。

外部 Agent/CI 从仓库根执行：

```sh
ACCEPTANCES_EXTERNAL_CI=1 make test SUITE=contract
```

该命令以 Node 原生 UTF-16 属性排序和数字编码独立复核 JCS golden bytes，然后执行 Go 契约测试。
`artifacts/contract.json` 记录限定范围；不代表数据库、服务、浏览器或完整验收矩阵通过。
