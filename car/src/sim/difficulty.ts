// 난이도(0.4.1): 상태의 difficulty(없으면 normal, 예전 저장)로 config.difficulty 표의 값을 고른다
import { config } from '../config';
import type { CarState, Difficulty } from './types';

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
export const diffOf = (s: Pick<CarState, 'difficulty'>) => config.difficulty[s.difficulty ?? 'normal'];
/** 새 게임 화면용: 세 난이도의 이름·한 줄 설명·주요 차이 */
export const difficultyInfo = () => DIFFICULTIES.map((id) => {
  const d = config.difficulty[id];
  return { id, name: d.name, desc: d.desc, cash: d.cash, loanBase: d.loanBase, bankruptcyMonths: d.bankruptcyMonths, bailouts: d.bailouts, isDefault: id === 'easy' };
});
