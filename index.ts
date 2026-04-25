import { execute } from "./src/runtime/command.ts";
import { displayPending, displayResponse } from "./src/views/response.tsx";

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
    throw error;
  }
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
