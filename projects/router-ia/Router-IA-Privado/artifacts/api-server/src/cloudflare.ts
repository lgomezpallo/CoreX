import { handleAsNodeRequest } from "cloudflare:node";
import app from "./app";

const port = 3000;
app.listen(port);

export default {
  fetch(request: Request): Promise<Response> {
    return handleAsNodeRequest(port, request);
  },
};
