import { SharePartyKind, SplitMode } from "../../shared/constants";

export interface SplitShareDTO {
  party: SharePartyKind;
  contactId?: string | null;
  percent?: number | null;
  fixedAmount?: number | null;
}

export interface SplitDTO {
  mode: SplitMode;
  guests?: { count: number; name?: string | null } | null;
  shares: SplitShareDTO[];
}

export interface CreateSharedExpenseDTO {
  id?: string;
  groupId: string;
  description?: string | null;
  // Both come from the movement when `transactionId` names one, and are stated otherwise.
  date?: Date;
  amount?: number;
  // A movement of the user's, which this expense then is: its amount, date and description.
  transactionId?: string;
  // null is the user: a line somebody else paid is not the user's expense yet.
  paidByContactId?: string | null;
  // Absent inherits the group's default split, without asking.
  split?: SplitDTO;
  userId: string;
}

export interface UpdateSharedExpenseDTO {
  id?: string;
  description?: string | null;
  date?: Date;
  amount?: number;
  paidByContactId?: string | null;
  split?: SplitDTO;
  // Clears the custom split and goes back to the group's default, from now on.
  useGroupSplit?: boolean;
}
