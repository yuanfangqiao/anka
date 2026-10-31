# 应用保活示例

从项目根复制到插件目录，然后在控制台的插件管理中安装：

```sh
cp -R examples/plugins/runtime-notes plugins/runtime-notes
cp -R examples/plugins/runtime-page plugins/runtime-page
```

打开两个应用，分别输入文字，反复切换检查草稿、光标与滚动位置。
通过“运行中的应用”尝试关闭，未保存时会阻止；保存后可关闭并重新打开。
桌面支持分屏。网页应用的详情按钮演示虚拟路由、系统返回与链接同步。
SDK 接口见 docs/APP-RUNTIME.md；这些示例不需要独立 npm 安装。
