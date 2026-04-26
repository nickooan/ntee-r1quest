import { execute } from "./src/runtime/command.ts";
import {
  displayPending,
  formatError,
  formatResponse,
} from "./src/views/response.tsx";

const main = async () => {
  const pendingView = displayPending();

  try {
    const response = await execute(Bun.argv.slice(2));

    pendingView.clear();
    pendingView.unmount();
    console.log(formatResponse(response));
  } catch (error) {
    pendingView.clear();
    pendingView.unmount();
    console.error(formatError(error));
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  await main();
}
