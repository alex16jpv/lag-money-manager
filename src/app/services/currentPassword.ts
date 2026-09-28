import bcryptjs from "bcryptjs";

import { User } from "../../domain/entities/User";
import { ApiError } from "../../shared/errors";

export async function assertCurrentPassword(
  user: User,
  candidate: string | undefined,
): Promise<void> {
  const ok =
    !!candidate &&
    !!user.password &&
    (await bcryptjs.compare(candidate, user.password));
  if (!ok) {
    throw new ApiError(
      "Unauthorized",
      "Current password is incorrect",
      "CURRENT_PASSWORD_INVALID",
    );
  }
}
