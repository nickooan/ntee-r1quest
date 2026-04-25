import { execute } from "./src/runtime/command.ts";
import { displayResponse } from "./src/views/response.tsx";

const main = async () => {
  const response = await execute(Bun.argv.slice(2));

  displayResponse(response);
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
