import assert from "node:assert/strict";
import type { Frame } from "playwright";
import type { BehaviorCheck, EvalTask } from "./types";

// Change the version whenever prompts, assertions, or the deterministic clock change.
export const SUITE_VERSION = "1.0.0";
export const FIXED_NOW = "2030-06-15T12:00:00.000Z";
export const FIXED_BROWSER_TIME = FIXED_NOW;
export const LONG_TITLE =
  "中文长任务：" + "认真校验新增、完成和删除后的真实状态。".repeat(12);

function check(
  id: string,
  name: string,
  run: BehaviorCheck["run"],
): BehaviorCheck {
  return { id, name, kind: "behavior", run };
}

function regress(checks: BehaviorCheck[]): BehaviorCheck[] {
  return checks.map((item) => ({ ...item, kind: "regression" }));
}

async function count(frame: Frame, listName: string, expected: number) {
  const list = frame.getByRole("list", { name: listName, exact: true });
  await list.waitFor({ state: "attached" });
  const items = list.getByRole("listitem");
  assert.equal(
    await items.count(),
    expected,
    `${listName}应有 ${expected} 条记录`,
  );
}

async function addTodo(frame: Frame, title: string) {
  await frame.getByRole("textbox", { name: "新任务", exact: true }).fill(title);
  await frame.getByRole("button", { name: "添加任务", exact: true }).click();
  await frame
    .getByRole("listitem", { name: `任务：${title}`, exact: true })
    .waitFor();
}

const todoBase = [
  check("todo-add", "新增任务并清空输入", async (frame) => {
    await addTodo(frame, "整理采访记录");
    await count(frame, "任务列表", 1);
    assert.equal(
      await frame
        .getByRole("textbox", { name: "新任务", exact: true })
        .inputValue(),
      "",
    );
  }),
  check("todo-complete", "完成状态可切换并可恢复", async (frame) => {
    await addTodo(frame, "完成发布准备");
    const checkbox = frame.getByRole("checkbox", {
      name: "完成 完成发布准备",
      exact: true,
    });
    await checkbox.check();
    assert.equal(await checkbox.isChecked(), true);
    await checkbox.uncheck();
    assert.equal(await checkbox.isChecked(), false);
    await count(frame, "任务列表", 1);
  }),
  check("todo-delete", "删除只移除目标任务", async (frame) => {
    await addTodo(frame, "保留任务");
    await addTodo(frame, "删除任务");
    await frame
      .getByRole("button", { name: "删除 删除任务", exact: true })
      .click();
    await count(frame, "任务列表", 1);
    assert.equal(
      await frame
        .getByRole("listitem", { name: "任务：保留任务", exact: true })
        .count(),
      1,
    );
  }),
  check("todo-input", "拒绝空输入并保留中文长文本", async (frame) => {
    await frame
      .getByRole("textbox", { name: "新任务", exact: true })
      .fill("   ");
    const add = frame.getByRole("button", { name: "添加任务", exact: true });
    if (await add.isEnabled()) await add.click();
    await count(frame, "任务列表", 0);
    await addTodo(frame, LONG_TITLE);
    await count(frame, "任务列表", 1);
  }),
];

const todoTheme = check(
  "todo-theme",
  "深色主题实际改变配色且保留任务",
  async (frame) => {
    await addTodo(frame, "切换主题前的任务");
    await frame
      .getByRole("checkbox", { name: "完成 切换主题前的任务", exact: true })
      .check();
    const theme = frame.getByRole("button", { name: "深色主题", exact: true });
    assert.equal(await theme.getAttribute("aria-pressed"), "false");
    const color = () =>
      frame
        .getByRole("main")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    const before = await color();
    await theme.click();
    assert.equal(await theme.getAttribute("aria-pressed"), "true");
    assert.notEqual(
      await color(),
      before,
      "主题切换必须改变主区域的实际背景色",
    );
    await count(frame, "任务列表", 1);
    assert.equal(
      await frame
        .getByRole("checkbox", { name: "完成 切换主题前的任务", exact: true })
        .isChecked(),
      true,
    );
    await theme.click();
    assert.equal(await theme.getAttribute("aria-pressed"), "false");
    assert.equal(await color(), before);
    assert.equal(
      await frame
        .getByRole("checkbox", { name: "完成 切换主题前的任务", exact: true })
        .isChecked(),
      true,
    );
  },
);

const todoFilter = check(
  "todo-filter",
  "未完成筛选与全部视图一致",
  async (frame) => {
    await addTodo(frame, "尚未处理");
    await addTodo(frame, "已经处理");
    await frame
      .getByRole("checkbox", { name: "完成 已经处理", exact: true })
      .check();
    await frame.getByRole("button", { name: "未完成", exact: true }).click();
    await count(frame, "任务列表", 1);
    assert.equal(
      await frame
        .getByRole("listitem", { name: "任务：尚未处理", exact: true })
        .count(),
      1,
    );
    await frame.getByRole("button", { name: "全部", exact: true }).click();
    await count(frame, "任务列表", 2);
    assert.equal(
      await frame
        .getByRole("checkbox", { name: "完成 已经处理", exact: true })
        .isChecked(),
      true,
    );
    await frame.getByRole("button", { name: "未完成", exact: true }).click();
    // Completion intentionally removes this checkbox from the filtered view.
    await frame
      .getByRole("checkbox", { name: "完成 尚未处理", exact: true })
      .click();
    await count(frame, "任务列表", 0);
    await frame.getByRole("button", { name: "全部", exact: true }).click();
    await frame
      .getByRole("checkbox", { name: "完成 尚未处理", exact: true })
      .uncheck();
    await frame.getByRole("button", { name: "未完成", exact: true }).click();
    await frame
      .getByRole("button", { name: "删除 尚未处理", exact: true })
      .click();
    await count(frame, "任务列表", 0);
    await frame.getByRole("button", { name: "全部", exact: true }).click();
    await count(frame, "任务列表", 1);
  },
);

const todoEdit = check(
  "todo-edit",
  "编辑标题保留完成状态和其他任务",
  async (frame) => {
    await addTodo(frame, "编辑前标题");
    await addTodo(frame, "另一项任务");
    await frame
      .getByRole("checkbox", { name: "完成 编辑前标题", exact: true })
      .check();
    await frame
      .getByRole("button", { name: "编辑 编辑前标题", exact: true })
      .click();
    await frame
      .getByRole("textbox", { name: "编辑任务", exact: true })
      .fill("   ");
    const save = frame.getByRole("button", { name: "保存任务", exact: true });
    if (await save.isEnabled()) await save.click();
    assert.equal(
      await frame
        .getByRole("listitem", { name: "任务：编辑前标题", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await frame
        .getByRole("checkbox", { name: "完成 编辑前标题", exact: true })
        .isChecked(),
      true,
    );
    await frame
      .getByRole("textbox", { name: "编辑任务", exact: true })
      .fill("修改后的中文标题");
    await frame.getByRole("button", { name: "保存任务", exact: true }).click();
    await count(frame, "任务列表", 2);
    assert.equal(
      await frame
        .getByRole("listitem", { name: "任务：编辑前标题", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await frame
        .getByRole("checkbox", { name: "完成 修改后的中文标题", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(
      await frame
        .getByRole("listitem", { name: "任务：另一项任务", exact: true })
        .count(),
      1,
    );
    await frame.getByRole("button", { name: "未完成", exact: true }).click();
    await count(frame, "任务列表", 1);
  },
);

async function calculate(frame: Frame, keys: string[], expected: number) {
  for (const key of keys)
    await frame.getByRole("button", { name: key, exact: true }).click();
  const raw = (
    await frame
      .getByRole("status", { name: "计算结果", exact: true })
      .innerText()
  ).trim();
  assert.ok(
    raw.length > 0 && Number.isFinite(Number(raw)),
    `计算结果必须是数字，实际为 ${raw}`,
  );
  assert.ok(
    Math.abs(Number(raw) - expected) < 1e-10,
    `预期 ${expected}，实际 ${raw}`,
  );
}

const calculatorBase = [
  check("calculator-arithmetic", "加减乘除得到真实结果", async (frame) => {
    await calculate(frame, ["8", "加", "3", "等于"], 11);
    await calculate(frame, ["清空", "8", "减", "3", "等于"], 5);
    await calculate(frame, ["清空", "8", "乘", "3", "等于"], 24);
    await calculate(frame, ["清空", "8", "除", "4", "等于"], 2);
  }),
  check("calculator-decimal", "小数计算没有浮点尾数", async (frame) => {
    await calculate(
      frame,
      ["0", "小数点", "1", "加", "0", "小数点", "2", "等于"],
      0.3,
    );
    const text = (
      await frame
        .getByRole("status", { name: "计算结果", exact: true })
        .innerText()
    ).trim();
    assert.equal(text, "0.3");
  }),
  check("calculator-reset", "清空同时重置数字和待算运算符", async (frame) => {
    await calculate(frame, ["9", "加", "8", "清空"], 0);
    await calculate(frame, ["4", "乘", "3", "等于"], 12);
  }),
  check(
    "calculator-new-expression",
    "等号后输入开始新的计算",
    async (frame) => {
      await calculate(frame, ["2", "加", "3", "等于"], 5);
      await calculate(frame, ["7", "减", "2", "等于"], 5);
    },
  ),
];

const calculatorHistory = check(
  "calculator-history",
  "计算历史顺序正确并能单独清空",
  async (frame) => {
    await calculate(frame, ["2", "加", "3", "等于"], 5);
    await calculate(frame, ["清空", "8", "除", "4", "等于"], 2);
    const history = frame
      .getByRole("list", { name: "计算历史", exact: true })
      .getByRole("listitem");
    assert.deepEqual(
      (await history.allTextContents()).map((value) => value.trim()),
      ["8 / 4 = 2", "2 + 3 = 5"],
    );
    await frame.getByRole("button", { name: "清空历史", exact: true }).click();
    await count(frame, "计算历史", 0);
    await calculate(frame, [], 2);
  },
);

async function addContent(
  frame: Frame,
  title: string,
  status = "待办",
  channel = "公众号",
  date = "2030-06-16",
) {
  await frame
    .getByRole("textbox", { name: "内容标题", exact: true })
    .fill(title);
  await frame
    .getByRole("combobox", { name: "状态", exact: true })
    .selectOption({ label: status });
  await frame
    .getByRole("combobox", { name: "渠道", exact: true })
    .selectOption({ label: channel });
  await frame.getByLabel("发布日期", { exact: true }).fill(date);
  await frame.getByRole("button", { name: "添加内容", exact: true }).click();
  await frame
    .getByRole("listitem", { name: `内容：${title}`, exact: true })
    .waitFor();
}

const boardBase = [
  check("board-add", "新增内容保留标题、状态、渠道和日期", async (frame) => {
    await addContent(frame, "新品发布计划", "进行中", "小红书", "2030-06-17");
    await count(frame, "内容列表", 1);
    const item = frame.getByRole("listitem", {
      name: "内容：新品发布计划",
      exact: true,
    });
    assert.ok((await item.innerText()).includes("小红书"));
    assert.ok((await item.innerText()).includes("2030-06-17"));
    assert.equal(
      await frame
        .getByRole("combobox", { name: "状态 新品发布计划", exact: true })
        .inputValue(),
      "进行中",
    );
    assert.equal(
      await frame
        .getByRole("textbox", { name: "内容标题", exact: true })
        .inputValue(),
      "",
    );
  }),
  check(
    "board-state-delete",
    "内容状态可切换且删除只影响目标",
    async (frame) => {
      await addContent(frame, "推进中的文章");
      await addContent(frame, "保留的视频", "待办", "视频号");
      const status = frame.getByRole("combobox", {
        name: "状态 推进中的文章",
        exact: true,
      });
      await status.selectOption({ label: "进行中" });
      assert.equal(await status.inputValue(), "进行中");
      await status.selectOption({ label: "已完成" });
      assert.equal(await status.inputValue(), "已完成");
      await frame
        .getByRole("button", { name: "删除 推进中的文章", exact: true })
        .click();
      await count(frame, "内容列表", 1);
      assert.equal(
        await frame
          .getByRole("listitem", { name: "内容：保留的视频", exact: true })
          .count(),
        1,
      );
    },
  ),
  check("board-input", "拒绝空标题或空日期并支持中文长标题", async (frame) => {
    await frame
      .getByRole("textbox", { name: "内容标题", exact: true })
      .fill("   ");
    await frame.getByLabel("发布日期", { exact: true }).fill("2030-06-16");
    const add = frame.getByRole("button", { name: "添加内容", exact: true });
    if (await add.isEnabled()) await add.click();
    await count(frame, "内容列表", 0);
    await frame
      .getByRole("textbox", { name: "内容标题", exact: true })
      .fill("没有日期");
    await frame.getByLabel("发布日期", { exact: true }).fill("");
    if (await add.isEnabled()) await add.click();
    await count(frame, "内容列表", 0);
    await addContent(frame, LONG_TITLE, "待办", "视频号", "2030-06-20");
    await count(frame, "内容列表", 1);
  }),
];

const boardChannel = check(
  "board-channel",
  "渠道筛选只显示匹配内容且恢复全部",
  async (frame) => {
    await addContent(frame, "公众号文章", "待办", "公众号");
    await addContent(frame, "红书图文", "进行中", "小红书");
    await addContent(frame, "视频号短片", "已完成", "视频号");
    const filter = frame.getByRole("combobox", {
      name: "渠道筛选",
      exact: true,
    });
    await filter.selectOption({ label: "小红书" });
    await count(frame, "内容列表", 1);
    assert.equal(
      await frame
        .getByRole("listitem", { name: "内容：红书图文", exact: true })
        .count(),
      1,
    );
    await filter.selectOption({ label: "全部" });
    await count(frame, "内容列表", 3);
  },
);

const boardOverdue = check(
  "board-overdue",
  "逾期筛选遵守日期、状态和渠道组合",
  async (frame) => {
    await addContent(frame, "红书逾期", "进行中", "小红书", "2030-06-14");
    await addContent(frame, "公众号逾期", "待办", "公众号", "2030-06-14");
    await addContent(frame, "红书未来", "待办", "小红书", "2030-06-16");
    await addContent(frame, "红书已完成", "已完成", "小红书", "2030-06-14");
    await addContent(frame, "红书今天", "待办", "小红书", "2030-06-15");
    await frame
      .getByRole("combobox", { name: "渠道筛选", exact: true })
      .selectOption({ label: "小红书" });
    await frame
      .getByRole("checkbox", { name: "仅看逾期", exact: true })
      .check();
    await count(frame, "内容列表", 1);
    assert.equal(
      await frame
        .getByRole("listitem", { name: "内容：红书逾期", exact: true })
        .count(),
      1,
    );
    await frame
      .getByRole("combobox", { name: "状态 红书逾期", exact: true })
      .selectOption({ label: "已完成" });
    await count(frame, "内容列表", 0);
    await frame
      .getByRole("checkbox", { name: "仅看逾期", exact: true })
      .uncheck();
    await count(frame, "内容列表", 4);
  },
);

const boardEdit = check(
  "board-edit",
  "标题编辑保留日期、渠道、状态和筛选能力",
  async (frame) => {
    await addContent(frame, "旧内容标题", "进行中", "小红书", "2030-06-14");
    await frame
      .getByRole("button", { name: "编辑 旧内容标题", exact: true })
      .click();
    await frame
      .getByRole("textbox", { name: "编辑内容标题", exact: true })
      .fill("   ");
    const save = frame.getByRole("button", { name: "保存内容", exact: true });
    if (await save.isEnabled()) await save.click();
    assert.equal(
      await frame
        .getByRole("listitem", { name: "内容：旧内容标题", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await frame
        .getByRole("combobox", { name: "状态 旧内容标题", exact: true })
        .inputValue(),
      "进行中",
    );
    await frame
      .getByRole("textbox", { name: "编辑内容标题", exact: true })
      .fill("新的中文内容标题");
    await frame.getByRole("button", { name: "保存内容", exact: true }).click();
    await count(frame, "内容列表", 1);
    assert.equal(
      await frame
        .getByRole("listitem", { name: "内容：旧内容标题", exact: true })
        .count(),
      0,
    );
    const item = frame.getByRole("listitem", {
      name: "内容：新的中文内容标题",
      exact: true,
    });
    assert.ok((await item.innerText()).includes("小红书"));
    assert.ok((await item.innerText()).includes("2030-06-14"));
    assert.equal(
      await frame
        .getByRole("combobox", { name: "状态 新的中文内容标题", exact: true })
        .inputValue(),
      "进行中",
    );
    await frame
      .getByRole("combobox", { name: "渠道筛选", exact: true })
      .selectOption({ label: "小红书" });
    await frame
      .getByRole("checkbox", { name: "仅看逾期", exact: true })
      .check();
    await count(frame, "内容列表", 1);
  },
);

export const fixedTasks: EvalTask[] = [
  {
    id: "todo-create",
    name: "待办：创建",
    sequenceId: "todo",
    kind: "create",
    prompt:
      "创建一个中文待办小应用，初始任务列表为空。新增、切换完成、删除都必须真实操作内存状态；拒绝纯空白输入，允许至少 200 字的中文长标题，成功新增后清空输入。为自动评测提供可访问名称：主区域用 main；新增文本框名为‘新任务’，按钮‘添加任务’，列表名‘任务列表’，每条用 listitem 且 aria-label 为‘任务：<标题>’，原生复选框名为‘完成 <标题>’，删除按钮名为‘删除 <标题>’。完成状态用复选框 checked 表示。单页自包含，不依赖存储或网络。",
    checks: todoBase,
  },
  {
    id: "todo-theme",
    name: "待办：深色主题",
    sequenceId: "todo",
    kind: "modify",
    prompt:
      "在当前待办应用上添加深色主题切换。按钮可访问名称始终为‘深色主题’，aria-pressed 初始 false，开启后 true；main 区域真实背景色随之变化，再次点击恢复原配色。切换主题保留所有任务和完成状态。保留此前所有行为、标签和可访问名称。",
    checks: [...regress(todoBase), todoTheme],
  },
  {
    id: "todo-filter",
    name: "待办：未完成筛选",
    sequenceId: "todo",
    kind: "modify",
    prompt:
      "在当前待办应用上添加按钮‘全部’和‘未完成’，初始显示全部。未完成视图只显示未勾选任务；切换回全部显示所有任务且完成状态不变。完成或删除后立即刷新当前视图。保留此前新增、删除、主题、中文长文本及全部可访问名称。",
    checks: [...regress([...todoBase, todoTheme]), todoFilter],
  },
  {
    id: "todo-edit",
    name: "待办：编辑标题",
    sequenceId: "todo",
    kind: "modify",
    prompt:
      "在当前待办应用上添加任务标题编辑。每条按钮名为‘编辑 <标题>’，编辑文本框名‘编辑任务’，保存按钮‘保存任务’。保存有效中文标题后更新 listitem、完成复选框、编辑和删除按钮的名称，保留该任务完成状态以及其他任务；拒绝空标题。保留此前新增、删除、深色主题、未完成筛选及全部标签约定。",
    checks: [...regress([...todoBase, todoTheme, todoFilter]), todoEdit],
  },
  {
    id: "calculator-create",
    name: "计算器：创建",
    sequenceId: "calculator",
    kind: "create",
    prompt:
      "创建一个真实交互的中文计算器，支持两数加减乘除和小数，初始结果为 0。结果元素 role=status 且名称‘计算结果’，只显示数字。数字按钮名称为数字 0 到 9，运算按钮名‘加’‘减’‘乘’‘除’，小数点按钮名‘小数点’，等号按钮名‘等于’，重置按钮名‘清空’。0.1+0.2 应显示 0.3；清空同时重置数字和待算运算符；等号后输入数字开始新表达式，不拼到前一次结果后。单页自包含，不使用 eval 或网络。",
    checks: calculatorBase,
  },
  {
    id: "calculator-history",
    name: "计算器：计算历史",
    sequenceId: "calculator",
    kind: "modify",
    prompt:
      "在当前计算器上添加计算历史，列表名‘计算历史’，每条为 listitem，最新在前。历史文本格式严格为‘<左数> <ASCII 运算符> <右数> = <结果>’，例如‘2 + 3 = 5’和‘8 / 4 = 2’，运算符用 + - * /。每次有效等号计算新增一条；按钮‘清空历史’只清历史，不改变当前结果；‘清空’只重置计算输入，不清历史。保留此前小数、四则运算和状态重置行为及全部可访问名称。",
    checks: [...regress(calculatorBase), calculatorHistory],
  },
  {
    id: "board-create",
    name: "内容看板：创建",
    sequenceId: "board",
    kind: "create",
    prompt:
      "创建中文内容发布看板，初始内容为空。新增文本框名‘内容标题’，原生 select 名‘状态’（选项和值：待办、进行中、已完成），select 名‘渠道’（公众号、小红书、视频号），type=date 输入标签‘发布日期’，按钮‘添加内容’。拒绝空白标题或空日期，支持至少 200 字中文标题，新增后清空标题。列表名‘内容列表’，每条 listitem 的 aria-label 为‘内容：<标题>’，可见文本包含渠道和 YYYY-MM-DD 日期；每条状态 select 名‘状态 <标题>’，选项值与标签相同，可即时切换状态；删除按钮名‘删除 <标题>’。所有操作真实更新内存状态，单页自包含。",
    checks: boardBase,
  },
  {
    id: "board-channel",
    name: "内容看板：渠道筛选",
    sequenceId: "board",
    kind: "modify",
    prompt:
      "在当前内容看板添加原生 select，名称‘渠道筛选’，选项‘全部’‘公众号’‘小红书’‘视频号’，初始全部。筛选只显示匹配渠道，恢复全部保留所有记录及状态。保留此前新增、日期、状态切换、删除、空值校验、中文长标题及全部可访问名称。",
    checks: [...regress(boardBase), boardChannel],
  },
  {
    id: "board-overdue",
    name: "内容看板：逾期筛选",
    sequenceId: "board",
    kind: "modify",
    prompt:
      "在当前内容看板添加原生复选框‘仅看逾期’，初始不勾选。逾期定义为发布日期严格早于当天且状态不是已完成；今天不逾期，未来不逾期，已完成不逾期。从浏览器当前日期计算，不硬编码今天；评测浏览器时间固定为 2030-06-15。该筛选与渠道筛选取交集，状态改为已完成应立即从逾期视图消失；取消筛选恢复匹配渠道的所有记录。保留此前所有功能和可访问名称。",
    checks: [...regress([...boardBase, boardChannel]), boardOverdue],
  },
  {
    id: "board-edit",
    name: "内容看板：编辑标题",
    sequenceId: "board",
    kind: "modify",
    prompt:
      "在当前内容看板添加标题编辑。每条按钮名‘编辑 <标题>’，编辑文本框名‘编辑内容标题’，保存按钮‘保存内容’。保存有效标题后更新 listitem、状态 select、编辑和删除按钮名称，但保留渠道、日期、状态及其他记录；拒绝空标题。保留此前渠道和逾期组合筛选、状态切换、新增、删除、中文长标题及全部可访问名称。",
    checks: [...regress([...boardBase, boardChannel, boardOverdue]), boardEdit],
  },
];
