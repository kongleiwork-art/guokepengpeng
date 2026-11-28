import type { MbtiAxis, MbtiScenarioQuestion } from '../../src/lib/types.ts';

interface ScoredQuestion extends MbtiScenarioQuestion {
  axis: MbtiAxis;
  aDirection: 1 | -1;
}

// The first letter of each axis is the positive end. Closely related questions
// use different situations and switch the sides of their two choices.
export const SCENARIO_QUESTIONS: ScoredQuestion[] = [
  {
    id: 'after-a-busy-day', axis: 'EI', aDirection: 1,
    prompt: '今天的事情都做完了，接下来有一个小时完全归你。你通常怎么恢复精力？',
    a: '找熟悉的人聊聊今天的事。', b: '自己散步或安静做点事。',
  },
  {
    id: 'learning-a-tool', axis: 'SN', aDirection: -1,
    prompt: '第一次接触一个新工具，手边既有说明书也有几个成品。你会先看什么？',
    a: '看看它能做出什么，再猜猜能不能用于别的事。', b: '看看实际操作步骤，再照着做一个小样。',
  },
  {
    id: 'changing-a-plan', axis: 'TF', aDirection: 1,
    prompt: '小组只能保留一个方案。两位同伴都很投入，两种方案也都能做完。你会先用什么判断？',
    a: '按事先定好的要求逐条比较。', b: '看看每种方案会怎样影响参与的人。',
  },
  {
    id: 'free-saturday', axis: 'JP', aDirection: -1,
    prompt: '周六要出门办两件小事，剩下的时间可以自由安排。你平时怎么做？',
    a: '大致知道要去哪，到时候看情况决定先后。', b: '提前定好顺序和时间，在空档自由安排。',
  },
  {
    id: 'working-through-an-idea', axis: 'EI', aDirection: -1,
    prompt: '脑子里有一个模糊的想法，暂时也没有交付压力。你会怎么把它想清楚？',
    a: '先独自想一会儿，理出头绪再分享。', b: '先跟别人聊一会儿，在交流中把想法理顺。',
  },
  {
    id: 'telling-a-story', axis: 'SN', aDirection: 1,
    prompt: '朋友问起你刚看完的展览。你通常会从哪里说起？',
    a: '先说印象最深的一件作品和它的细节。', b: '先说贯穿展览的主题和它让我想到的事。',
  },
  {
    id: 'giving-feedback', axis: 'TF', aDirection: -1,
    prompt: '朋友请你点评一个草稿，也愿意认真修改。你会先跟对方谈哪件事？',
    a: '先问对方最想表达什么，一起看哪些地方可以保住初衷。', b: '先讲清最影响使用的具体问题，一起找修改办法。',
  },
  {
    id: 'two-week-project', axis: 'JP', aDirection: 1,
    prompt: '你有两周时间做一个小项目，而且每天都能抽出时间。你更喜欢从哪里开始？',
    a: '先定几个阶段和检查时间，再逐步推进。', b: '先试几个可行的做法，再随进展安排下一步。',
  },
  {
    id: 'a-new-group', axis: 'EI', aDirection: 1,
    prompt: '第一次去一个人数不多的兴趣活动，大家都在自由交流。你通常怎么参与？',
    a: '早点加入一两段对话，在交流中熟悉大家。', b: '先听和观察一会儿，遇到合适的话题再加入。',
  },
  {
    id: 'ambiguous-notes', axis: 'SN', aDirection: -1,
    prompt: '看到几条有点相关、暂时还看不出结论的笔记时，你会自然地做什么？',
    a: '想想它们是否能串成一个解释，还有哪些可能性。', b: '核对每条记录和具体例子，先确认目前知道的事。',
  },
  {
    id: 'fair-division', axis: 'TF', aDirection: 1,
    prompt: '两个人想调整已经商量好的分工，剩余工作量可以平衡。你会先拿什么作依据？',
    a: '先确认双方能共同接受、也适用于同样情况的规则。', b: '先了解双方各自看重什么，再考虑怎么调。',
  },
  {
    id: 'packing-for-a-trip', axis: 'JP', aDirection: -1,
    prompt: '你后天要出门两天，行程很轻松。你一般什么时候准备随身物品？',
    a: '出发前集中整理，按当时的需要取舍。', b: '提前列单和收拾，留一点时间补漏。',
  },
];

export const FOLLOW_UP_QUESTIONS: ScoredQuestion[] = [
  {
    id: 'spare-lunch-break', axis: 'EI', aDirection: -1,
    prompt: '午饭后突然多出半小时，没有任何安排。平常哪种休息更让你充好电？',
    a: '找个清静的地方，按自己的节奏待一会儿。', b: '找熟悉的人聊点轻松的话题。',
  },
  {
    id: 'unfamiliar-neighborhood', axis: 'SN', aDirection: 1,
    prompt: '走进一片陌生的街区，回来时你最容易记住哪一类东西？',
    a: '实际走过的路线、店铺或一个具体画面。', b: '街区给我的整体印象和由此想到的故事。',
  },
  {
    id: 'choosing-a-date', axis: 'TF', aDirection: -1,
    prompt: '排活动时有两个可行日期，参与者的偏好不同。你会先看哪类信息？',
    a: '每个人选那天的原因，以及改期会给谁带来麻烦。', b: '两个日期的出席人数和资源安排，再按一致条件比较。',
  },
  {
    id: 'change-of-venue', axis: 'JP', aDirection: 1,
    prompt: '约好的地方临时关门，附近还有几个能去的地方。你会更自然地怎么处理？',
    a: '选一个替代地点，把集合时间和后续安排告诉大家。', b: '先往附近走走，边看边和大家决定。',
  },
];
