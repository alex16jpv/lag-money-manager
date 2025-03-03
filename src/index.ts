import { ApiError, CustomError } from "./shared/errors";

try {
  throw new ApiError("NotFound");
} catch (error: unknown) {
  if (error instanceof ApiError) {
    console.error(error.name);
    console.error(error.message);
    console.error(error.statusCode);
    console.log(error.details);
  } else {
    console.error(error);
  }
}
