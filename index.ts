import { execute } from "./src/runtime/command.ts";
import {
  displayError,
  displayPending,
  displayResponse,
} from "./src/views/response.tsx";

const main = async () => {
  const pendingView = displayPending();

  try {
    const response = await execute(Bun.argv.slice(2));

    pendingView.clear();
    pendingView.unmount();
    displayResponse(response);
  } catch (error) {
    pendingView.clear();
    pendingView.unmount();
    displayError(error);
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  await main();
}
