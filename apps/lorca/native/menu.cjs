function applicationMenuTemplate(platform = process.platform) {
  const application = [
    { label: '关于 dots', role: 'about' },
    { type: 'separator' },
  ];
  if (platform === 'darwin') application.push(
    { label: '隐藏 dots', role: 'hide' },
    { label: '隐藏其他应用', role: 'hideOthers' },
    { label: '显示全部应用', role: 'unhide' },
    { type: 'separator' },
  );
  application.push({ label: '退出 dots', role: 'quit' });
  return [
    { label: '应用', submenu: application },
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '粘贴并匹配样式', role: 'pasteAndMatchStyle' },
      { type: 'separator' },
      { label: '全选', role: 'selectAll' },
    ] },
    { label: '窗口', submenu: [
      { label: '最小化', role: 'minimize' },
      { label: '缩放', role: 'zoom' },
      { type: 'separator' },
      { label: '关闭窗口', role: 'close' },
    ] },
  ];
}
module.exports = { applicationMenuTemplate };
