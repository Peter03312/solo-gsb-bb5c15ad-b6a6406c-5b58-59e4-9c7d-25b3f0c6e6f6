/* 刀路执行记录（纯函数）自检：标记 / 越序提示 / 重复标记 / 级联撤销 / 分支交错 */
import assert from 'node:assert';
import {
  cutStatus, markCut, undoCut,
  isItemPickable, itemMissingCuts, orderPickStats,
} from './src/cutProgress.js';

// 刀路样例（pred 来自后端回放）：
//   1(无前置) → 2 → 4；1 → 3；另 5(无前置) 独立分支
const cuts = [
  { seq: 1, pred: 0 },
  { seq: 2, pred: 1 },
  { seq: 3, pred: 1 },
  { seq: 4, pred: 2 },
  { seq: 5, pred: 0 },
];

// 初始状态：无前置的 1、5 可执行，其余被阻塞
let done = new Set();
let st = cutStatus(cuts, done);
assert.deepStrictEqual(st, { 1: 'ready', 2: 'blocked', 3: 'blocked', 4: 'blocked', 5: 'ready' });

// 越序标记：提示缺少的前置刀，状态不变
let r = markCut(cuts, done, 2);
assert.strictEqual(r.missing, 1);
assert.strictEqual(r.done.size, 0);
r = markCut(cuts, done, 4);
assert.strictEqual(r.missing, 2, '缺少的前置为直接前置而非根刀');

// 顺序标记 + 不同分支交错执行
done = markCut(cuts, done, 1).done;
done = markCut(cuts, done, 5).done; // 独立分支交错
done = markCut(cuts, done, 3).done; // 分支：1 → 3
done = markCut(cuts, done, 2).done; // 分支：1 → 2
st = cutStatus(cuts, done);
assert.deepStrictEqual(st, { 1: 'done', 2: 'done', 3: 'done', 4: 'ready', 5: 'done' });

// 重复标记不计数：状态原样返回
r = markCut(cuts, done, 2);
assert.strictEqual(r.repeated, true);
assert.strictEqual(r.done.size, 4);

// 撤销中间刀：级联撤销其已完成的后继（2 → 4 需先标记）
done = markCut(cuts, done, 4).done;
assert.strictEqual(done.size, 5);
let next = undoCut(cuts, done, 2);
assert.deepStrictEqual([...next].sort((a, b) => a - b), [1, 3, 5], '撤销第 2 刀应连带撤销第 4 刀，保留其他分支');

// 撤销根刀：整棵子树撤销，独立分支（5）保留
next = undoCut(cuts, done, 1);
assert.deepStrictEqual([...next], [5]);

// 撤销未完成的刀：状态不变
next = undoCut(cuts, done, 99);
assert.strictEqual(next.size, 5);
next = undoCut(cuts, new Set(), 1);
assert.strictEqual(next.size, 0);

// 无刀板：空刀路下状态为空、操作安全
assert.deepStrictEqual(cutStatus([], new Set()), {});
assert.strictEqual(markCut([], new Set(), 1).missing, 0);

// ---- 可取件联动：分离刀序全部完成才可取；无分离刀的件恒可取 ----
// 2×2 网格回放：左列两件分离刀序 [1,2]、右列两件 [1,3]；另有整板单件分离刀序 []
const doneByBoard = { 1: new Set() };
const itemL = { board: 1, releaseCuts: [1, 2] };
const itemR = { board: 1, releaseCuts: [1, 3] };
const itemFull = { board: 2, releaseCuts: [] }; // 无刀板，不依赖任何执行记录
assert.strictEqual(isItemPickable(itemL.releaseCuts, doneByBoard[1]), false);
assert.deepStrictEqual(itemMissingCuts(itemL.releaseCuts, doneByBoard[1]), [1, 2]);
// 空分离刀序（贴板边 / 整板单件）：恒为可取，即使没有该板的执行记录
assert.strictEqual(isItemPickable(itemFull.releaseCuts, undefined), true);
assert.strictEqual(isItemPickable(itemFull.releaseCuts, new Set()), true);
assert.deepStrictEqual(itemMissingCuts(itemFull.releaseCuts, undefined), []);
// releaseCuts 缺省（防御）同样按无需切刀处理
assert.strictEqual(isItemPickable(undefined, undefined), true);

// 完成第 1 刀后：两件都尚不可取，但尚缺刀序分别只剩第 2、第 3 刀（不同分支）
doneByBoard[1] = markCut(cuts, doneByBoard[1], 1).done;
assert.strictEqual(isItemPickable(itemL.releaseCuts, doneByBoard[1]), false);
assert.strictEqual(isItemPickable(itemR.releaseCuts, doneByBoard[1]), false);
assert.deepStrictEqual(itemMissingCuts(itemL.releaseCuts, doneByBoard[1]), [2]);
assert.deepStrictEqual(itemMissingCuts(itemR.releaseCuts, doneByBoard[1]), [3]);

// 再完成第 2 刀（分支可交错）：左列可取、右列仍缺第 3 刀
doneByBoard[1] = markCut(cuts, doneByBoard[1], 2).done;
assert.strictEqual(isItemPickable(itemL.releaseCuts, doneByBoard[1]), true);
assert.strictEqual(isItemPickable(itemR.releaseCuts, doneByBoard[1]), false);
assert.deepStrictEqual(itemMissingCuts(itemL.releaseCuts, doneByBoard[1]), []);
assert.deepStrictEqual(itemMissingCuts(itemR.releaseCuts, doneByBoard[1]), [3]);

// 撤销第 1 刀连带撤销第 2 刀：左列立即回到不可取（即时联动），尚缺刀序恢复
doneByBoard[1] = undoCut(cuts, doneByBoard[1], 1);
assert.strictEqual(isItemPickable(itemL.releaseCuts, doneByBoard[1]), false);
assert.deepStrictEqual(itemMissingCuts(itemL.releaseCuts, doneByBoard[1]), [1, 2]);

// 跨板订单：逐板查执行记录；只完成所在板的分离刀才算该件可取
doneByBoard[1] = new Set([1, 2]);
doneByBoard[3] = new Set();
const crossItems = [
  { board: 1, releaseCuts: [1, 2] }, // 板1 两刀均完成 → 可取
  { board: 2, releaseCuts: [1] },    // 板2 无执行记录 → 不可取
  { board: 3, releaseCuts: [] },     // 板3 整板单件 → 可取
];
const stats = orderPickStats(crossItems, doneByBoard);
assert.deepStrictEqual(stats, { ready: 2, total: 3 });
assert.strictEqual(isItemPickable(crossItems[1].releaseCuts, doneByBoard[2]), false);
assert.strictEqual(isItemPickable(crossItems[2].releaseCuts, doneByBoard[3]), true);

// 全部完成 / 一件订单的边界
assert.deepStrictEqual(orderPickStats([], doneByBoard), { ready: 0, total: 0 });
assert.deepStrictEqual(orderPickStats([{ board: 1, releaseCuts: [1] }], { 1: new Set([1]) }),
  { ready: 1, total: 1 });

console.log('刀路执行记录自检通过 ✔');
