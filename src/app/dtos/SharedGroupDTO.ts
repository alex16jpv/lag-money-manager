import { Color, GroupSplitMode } from "../../shared/constants";

export interface DefaultSplitDTO {
  mode: GroupSplitMode;
  // PERCENT only: one entry per participant, adding up to 100. null is the user.
  shares?: { contactId: string | null; percent: number }[];
}

export interface CreateSharedGroupDTO {
  id?: string;
  name: string;
  color?: Color;
  // The other people in the group; the owner is always a participant.
  contactIds?: string[];
  defaultSplit?: DefaultSplitDTO;
  userId: string;
}

export interface UpdateSharedGroupDTO {
  id?: string;
  name?: string;
  color?: Color | null;
  defaultSplit?: DefaultSplitDTO;
}

export interface AddParticipantsDTO {
  contactIds: string[];
  // Whole group or nothing: off, they are only in what you add from now on.
  applyToExistingExpenses?: boolean;
  // Required when the group's default is PERCENT: the old percentages no longer cover everybody.
  defaultSplit?: DefaultSplitDTO;
}

export interface WriteOffDTO {
  // One of the two: a person of the group, or the block of guests of that expense.
  contactId?: string;
  expenseId?: string;
}
