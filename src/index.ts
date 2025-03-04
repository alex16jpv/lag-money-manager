import { ApiError, CustomError } from "./shared/errors";
import { wait } from "./shared/utils";

const start = async () => {
  console.time("WAIT");
  await wait(500);
  console.timeEnd("WAIT");

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
};

start();
