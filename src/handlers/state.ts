import { PendingAdd, UserWaitingState } from "../types";

export const pendingAdds = new Map<number, PendingAdd>();
export const userWaitingMap = new Map<number, UserWaitingState>();

export interface PendingInterestAdd {
  tags: string[];
  messageId: number | null;
}
export const pendingInterestAdds = new Map<number, PendingInterestAdd>();
