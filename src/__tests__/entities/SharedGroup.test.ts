import { SharedGroup } from "../../domain/entities/SharedGroup";

const userId = "019576a0-d7b6-7d6d-af6a-2b7545f5ac70";

describe("SharedGroup Entity", () => {
  it("puts the owner in a group that names nobody else", () => {
    const group = new SharedGroup({ name: "Night out", userId });

    expect(group.participants).toEqual([{ contactId: null }]);
  });

  it("falls back to an equal default split", () => {
    const group = new SharedGroup({ name: "Night out", userId });

    expect(group.defaultSplit).toEqual({ mode: "EQUAL", shares: [] });
  });

  it("mints its own id and starts unarchived", () => {
    const group = new SharedGroup({ name: "Night out", userId });

    expect(group.id).toHaveLength(36);
    expect(group.archivedAt).toBeNull();
  });
});
