/* 刀路执行记录（纯函数）自检：标记 / 越序提示 / 重复标记 / 级联撤销 / 分支交错 / 可取件联动 */
import assert from 'node:assert';
import { cutStatus, markCut, undoCut, pickableState } from './src/cutProgress.js';

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

// ---- 可取件联动：全部分离刀完成才可取，尚缺刀序按刀序升序列出 ----
// 尚缺分离刀：列出未完成的刀序，不可取
let ps = pickableState({ board: 1, sep: [1, 2] }, { 1: new Set([1]) });
assert.deepStrictEqual(ps, { missing: [2], pickable: false });
// 全部分离刀完成：可取，无尚缺刀序
ps = pickableState({ board: 1, sep: [1, 2] }, { 1: new Set([1, 2]) });
assert.deepStrictEqual(ps, { missing: [], pickable: true });
// 跨板取件：按所在板号查完成记录，互不影响
ps = pickableState({ board: 2, sep: [1, 3] }, { 1: new Set([1, 3]) });
assert.deepStrictEqual(ps, { missing: [1, 3], pickable: false });
// 贴板边无需额外刀：空分离刀序直接可取（无需任何完成记录）
assert.strictEqual(pickableState({ board: 9, sep: [] }, {}).pickable, true);
// sep 缺失（旧数据兜底）按无分离刀处理
assert.strictEqual(pickableState({ board: 1 }, {}).pickable, true);

console.log('刀路执行记录自检通过 ✔');
