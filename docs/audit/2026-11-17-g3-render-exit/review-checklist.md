# G3人工可读性与桌面窗口验收表（待签，不能预填通过）

自动化基线：[36题渲染报告](README.md) 36/36 浏览器渲染通过，25题视觉warning；humanReviewed=pending。浏览器截图只是审阅材料，不代替用户在桌面窗口实际操作。**本表未签字，也不表示G3-UX关闭。**

## 审核方法

1. 打开[审阅首页](index.html)或每题原尺寸截图，对照[黄金合同](../../../test-fixtures/reliability/drawing-contracts-36.json)核对题目要求的对象、标签、虚实线、相机角度和关键对象是否可分辨。
2. 对含clipped_object的无限直线/函数，应判断必要交点/几何关系是否仍清楚；对tiny_object须检查关键点是否缩到无法辨认。不能一律把warning视为不影响。
3. 对每题分别填写“对象完整”“可读”“警告可接受”，如果任何项失败，写具体观察与修复建议，不直接把机器passed改成人工通过。
4. Windows真实桌面启动本次同版本程序，复核立体旋转、确认、撤销、保存重开、约束拖动；录入构建SHA、Windows版本、显示缩放、审阅人、日期和结果。
5. 用户/教师本人签收后才更新manifest的人审字段和当前状态；AI不能代签，也不能据“截图已生成”宣称用户认可。

## 逐题审阅（全部36题）

| 截图/题号 | 范围 | 自动warning | 对象完整 | 可读/无关键遮挡 | warning可接受 | 审阅人/日期/意见 |
| --- | --- | --- | --- | --- | --- | --- |
| [GK-P01](cases/GK-P01.png) | plane / plane | clipped_object | 待验 | 待验 | 待验 | — |
| [GK-P02](cases/GK-P02.png) | plane / plane | tiny_object | 待验 | 待验 | 待验 | — |
| [GK-P03](cases/GK-P03.png) | plane / plane | clipped_object、clipped_object、clipped_object | 待验 | 待验 | 待验 | — |
| [GK-P04](cases/GK-P04.png) | plane / function | clipped_object、clipped_object | 待验 | 待验 | 待验 | — |
| [GK-P05](cases/GK-P05.png) | plane / plane | clipped_object、clipped_object、tiny_object、clipped_object | 待验 | 待验 | 待验 | — |
| [GK-P06](cases/GK-P06.png) | plane / plane | clipped_object、clipped_object、clipped_object | 待验 | 待验 | 待验 | — |
| [GK-P07](cases/GK-P07.png) | plane / plane | clipped_object、clipped_object、clipped_object | 待验 | 待验 | 待验 | — |
| [GK-P08](cases/GK-P08.png) | plane / plane | 无 | 待验 | 待验 | 待验 | — |
| [GK-P09](cases/GK-P09.png) | plane / function | clipped_object、clipped_object | 待验 | 待验 | 待验 | — |
| [GK-S01](cases/GK-S01.png) | solid / solid | tiny_object | 待验 | 待验 | 待验 | — |
| [GK-S02](cases/GK-S02.png) | solid / fold | 无 | 待验 | 待验 | 待验 | — |
| [GK-S03](cases/GK-S03.png) | solid / solid | 无 | 待验 | 待验 | 待验 | — |
| [GK-S04](cases/GK-S04.png) | solid / solid | tiny_object | 待验 | 待验 | 待验 | — |
| [GK-S05](cases/GK-S05.png) | solid / solid | tiny_object、tiny_object | 待验 | 待验 | 待验 | — |
| [GK-S06](cases/GK-S06.png) | solid / solid | 无 | 待验 | 待验 | 待验 | — |
| [GK-S07](cases/GK-S07.png) | solid / solid | tiny_object、tiny_object | 待验 | 待验 | 待验 | — |
| [GK-S08](cases/GK-S08.png) | solid / solid | tiny_object | 待验 | 待验 | 待验 | — |
| [GK-S09](cases/GK-S09.png) | solid / solid | tiny_object、tiny_object | 待验 | 待验 | 待验 | — |
| [JT-P01](cases/JT-P01.png) | plane / plane | tiny_object | 待验 | 待验 | 待验 | — |
| [JT-P02](cases/JT-P02.png) | plane / plane | tiny_object、clipped_object、clipped_object | 待验 | 待验 | 待验 | — |
| [JT-P03](cases/JT-P03.png) | plane / plane | clipped_object、tiny_object、tiny_object、clipped_object | 待验 | 待验 | 待验 | — |
| [JT-P04](cases/JT-P04.png) | plane / plane | clipped_object、clipped_object、clipped_object | 待验 | 待验 | 待验 | — |
| [JT-P05](cases/JT-P05.png) | plane / plane | clipped_object、clipped_object、clipped_object | 待验 | 待验 | 待验 | — |
| [JT-P06](cases/JT-P06.png) | plane / plane | 无 | 待验 | 待验 | 待验 | — |
| [JT-P07](cases/JT-P07.png) | plane / plane | tiny_object、tiny_object | 待验 | 待验 | 待验 | — |
| [JT-P08](cases/JT-P08.png) | plane / plane | 无 | 待验 | 待验 | 待验 | — |
| [JT-P09](cases/JT-P09.png) | plane / plane | 无 | 待验 | 待验 | 待验 | — |
| [JT-S01](cases/JT-S01.png) | solid / fold | 无 | 待验 | 待验 | 待验 | — |
| [JT-S02](cases/JT-S02.png) | solid / solid | 无 | 待验 | 待验 | 待验 | — |
| [JT-S03](cases/JT-S03.png) | solid / solid | tiny_object | 待验 | 待验 | 待验 | — |
| [JT-S04](cases/JT-S04.png) | solid / fold | tiny_object | 待验 | 待验 | 待验 | — |
| [JT-S05](cases/JT-S05.png) | solid / solid | 无 | 待验 | 待验 | 待验 | — |
| [JT-S06](cases/JT-S06.png) | solid / solid | 无 | 待验 | 待验 | 待验 | — |
| [JT-S07](cases/JT-S07.png) | solid / solid | tiny_object | 待验 | 待验 | 待验 | — |
| [JT-S08](cases/JT-S08.png) | solid / solid | tiny_object、tiny_object | 待验 | 待验 | 待验 | — |
| [JT-S09](cases/JT-S09.png) | solid / solid | tiny_object、tiny_object、tiny_object、tiny_object | 待验 | 待验 | 待验 | — |

## Windows桌面窗口验收（待办）

| 项目 | 待填写 |
| --- | --- |
| 构建/二进制SHA-256 | — |
| Windows/WebView/显示缩放 | — |
| 启动窗口与相机/标签 | 待验 |
| 草稿确认、一次提交、撤销重做 | 待验 |
| 保存关闭重开、已有档兼容 | 待验 |
| 空间拖动/折叠/球体/函数 | 待验 |
| 异常/取消时主文档保持安全 | 待验 |
| 审阅人、日期及明确签收结论 | — |

若桌面窗口无法自动操控，保持“待验”，不要用本地核心/Rust单元或浏览器E2E替代。DS真实模型画图评测与P8发布仍分别按其他门禁执行。
