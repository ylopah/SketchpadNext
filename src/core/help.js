export const HELP_SECTIONS = Object.freeze([
  {
    id: "basics",
    title: "开始与选择",
    items: [
      { title: "选择/移动", shortcut: "Alt+V", description: "单击对象进行选择；按 Shift 可增减多选。拖动点或对象改变图形，拖动空白区域可框选。双击文本进入编辑。" },
      { title: "移动画布", description: "按住空格后拖动、按住鼠标中键拖动，或按住鼠标右键拖动。滚轮在光标位置缩放画布。" },
      { title: "取消与删除", description: "Esc 取消未完成的构造；Delete 删除已选对象。删除父对象时，其依赖对象也会一并删除。" },
      { title: "吸附", description: "开启“吸附与网格”后显示吸附网格，创建或拖动点时吸附到网格；临时按 Alt 可跳过吸附。" },
      { title: "手机与平板", description: "界面会根据浏览器 UA、屏幕方向和触控能力自动适配：手机竖屏使用底部滑动工具栏，横屏使用左侧窄工具栏；点“属性”打开抽屉，“更多”包含文件、LaTeX、说明和设置。画布支持单指作图、双指平移与捏合，顶部设备徽标可查看当前 UA。" },
    ],
  },
  {
    id: "drawing-tools",
    title: "左侧绘图工具",
    items: [
      { title: "点", shortcut: "Alt+P", description: "在空白处创建自由点；在线、射线、线段或圆上点击可创建受约束的点；在交叉处点击可创建动态交点。" },
      { title: "线段", shortcut: "Alt+S", description: "依次选取两个点。也可以直接在空白处点击，系统会自动创建端点。" },
      { title: "直线", shortcut: "Alt+L", description: "依次选取两个点，生成经过两点并向两端无限延伸的直线。" },
      { title: "射线", shortcut: "Alt+Y", description: "先选端点，再选方向点，生成从端点经过方向点无限延伸的射线。" },
      { title: "圆", shortcut: "Alt+C", description: "先选圆心，再选圆上一点；也可在“构造”菜单中用圆心和一条线段构造动态半径圆。" },
      { title: "过三点圆", shortcut: "Alt+O", description: "依次选取三个不共线的点。系统保留动态圆心，但不显示或占用普通点的字母。" },
      { title: "中点", shortcut: "Alt+M", description: "点击一条线段，或依次选择两个点，创建随父对象联动的中点。" },
      { title: "中垂线", shortcut: "Alt+N", description: "选择一条线段，或直接依次点出两个位置，创建两点连线的垂直平分线。" },
      { title: "平行线", shortcut: "Alt+R", description: "选择一个点和一条基准线；预先多选多个点与多条线时，会对每个“点 × 线”组合批量构造。" },
      { title: "垂线", shortcut: "Alt+T", description: "选择一个点和一条基准线；预先多选多个点与多条线时，会对每个“点 × 线”组合批量构造。" },
      { title: "角平分线", shortcut: "Alt+B", description: "可依次选第一边上的点、公共顶点、第二边上的点；也可先选择具有同一端点的两条边后使用。" },
      { title: "标识笔", shortcut: "Alt+K", description: "在角的顶点按下并向角内拖动，添加角标识；点击已有标识可切换弧线数量。在线段上拖动可添加等长或平行标识。" },
      { title: "信息", shortcut: "Alt+I", description: "点击对象查看类型、父对象与子对象。按住 Shift 可让信息面板保持显示。" },
      { title: "文本", shortcut: "Alt+X", description: "点击空白处创建文本；在选择状态下双击已有文本可编辑，拖动可调整位置。点名中的 _ 表示下标，^ 表示上标。" },
    ],
  },
  {
    id: "menus",
    title: "构造、度量与变换",
    items: [
      { title: "构造菜单", description: "先选中满足条件的对象，再从“构造…”选择线段、交点、中点、圆弧、内部、轨迹等命令。菜单会一次处理所有有效选择。" },
      { title: "三角形中心与内切圆", description: "选中三个不共线的顶点后，可在“构造…”中直接创建动态重心、内心、垂心或内切圆；拖动任一顶点时结果会同步更新。" },
      { title: "度量菜单", description: "菜单按长度与角度、面积与周长、坐标与验证分组。先按要求选中对象，再创建会随父对象和点名同步更新的度量值；显示小数位可在设置中调整。" },
      { title: "变换菜单", description: "先标记中心或镜面，再选对象执行平移、旋转、缩放、反射；“重复最近变换”用于快速迭代。" },
      { title: "计算与坐标菜单", description: "菜单分为计算、坐标系和函数绘图三组，可创建动态参数与计算、坐标系、函数图像、极坐标图、参数曲线和数据表。" },
      { title: "显示菜单", description: "用于隐藏、锁定、调整层级、追踪对象，以及创建显示/隐藏、动画、移动、链接和声音按钮。" },
    ],
  },
  {
    id: "numeric-coordinate",
    title: "度量、计算与坐标系",
    items: [
      { title: "点到线的距离", description: "选择一个点以及一条线段、射线或直线后使用。线段会限制在两个端点之间，射线会限制在起点之后，直线则按无限延伸方向计算最短距离。" },
      { title: "多边形周长与面积", description: "按边界顺序选择至少三个点；系统自动连接末点与首点并创建动态周长或面积。拖动顶点、重命名点时，结果和说明文字都会更新。" },
      { title: "坐标度量", description: "选择一个或多个点，可度量完整坐标，也可分别度量横坐标 x 或纵坐标 y。选中的坐标系优先；只有一个可见坐标系时自动使用它，存在多个可见坐标系时需先明确选择。" },
      { title: "参数、度量与计算", description: "参数、度量值和计算结果都是可被其他表达式引用的动态数值对象。选择数值对象后，属性检查器会显示名称、当前值、单位或表达式，并提供相应编辑入口。" },
      { title: "表达式与角度单位", description: "支持 +、-、*、/、^、括号、pi、e，以及 sqrt、abs、ln、log、exp、round、floor、ceil 等函数。sin/cos/tan 和 asin/acos/atan 使用弧度；sind/cosd/tand 与 asind/acosd/atand 使用角度制，rad(180) 把角度转为弧度，deg(pi) 把弧度转为角度。" },
      { title: "双参数函数", description: "min(a,b)、max(a,b)、atan2(y,x) 和 mod(a,b) 接受两个参数；atan2 返回弧度，需要角度结果时可写 deg(atan2(y,x))。" },
      { title: "坐标系属性", description: "坐标系可分别设置横轴与纵轴单位间距、方格/矩形/极坐标网格，以及网格、刻度线和刻度数字的显示状态。自由原点可拖动，绑定到点的原点会随该点更新。" },
      { title: "坐标系与吸附", description: "开启全局吸附后，若已选择一个坐标系，或画板中只有一个可见坐标系，点会按该坐标系的原点及横纵单位间距吸附；存在多个可见坐标系且未选择时，回退到全局网格。按住 Alt 可临时跳过吸附。" },
      { title: "函数绘图", description: "先创建或选择坐标系，再绘制 y=f(x)、x=f(y)、极坐标、导函数或参数曲线。表达式会保存对参数和计算结果的动态依赖。" },
    ],
  },
  {
    id: "editing",
    title: "命名、样式与工程",
    items: [
      { title: "命名", description: "选择一个点后在属性检查器中编辑名称。输入期间不会因一个字符而退出；清空名称不会删除点。使用 A_1、x^2 等写法可显示上下标。" },
      { title: "数学符号", description: "点名与文本支持 \\alpha、\\theta、\\pi、\\angle、\\perp、\\parallel、\\neq、\\le、\\ge、\\pm、\\times、\\infty 等常用写法；_ 表示下标，^ 表示上标。" },
      { title: "样式", description: "有选择时，属性检查器修改所选对象；没有选择时，修改新建对象的默认样式。更完整的默认值在“设置”中保存。" },
      { title: "保存与打开", description: "“保存”写入当前 .spn 工程，“另存为”选择新位置；“复制 LaTeX”把当前页面与当前视图转换为 TikZ 代码。" },
      { title: "撤销与重做", description: "Ctrl+Z 撤销，Ctrl+Y 或 Ctrl+Shift+Z 重做。一次完整的批量构造只占用一条历史记录。" },
    ],
  },
]);

export function helpItemCount(sections = HELP_SECTIONS) {
  return sections.reduce((total, section) => total + section.items.length, 0);
}
