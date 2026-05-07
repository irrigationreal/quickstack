import type http from "node:http";
import { Server } from "socket.io";
import { getToken } from "next-auth/jwt";
import terminalService from "./server/services/terminal.service";
import userGroupService from "./server/services/user-group.service";

class SocketIoServer {
	initialize(server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>) {
		const io = new Server(server);
		const podLogsNamespace = io.of("/pod-terminal");
		podLogsNamespace.use(async (socket, next) => {
			try {
				const token = await getToken({ req: socket.request as any });
				const email = token?.email;
				if (!email) {
					return next(new Error("Unauthorized"));
				}
				socket.data.userSession = {
					email,
					userGroup: await userGroupService.getRoleByUserMail(email),
				};
				next();
			} catch (error) {
				next(error as Error);
			}
		});
		podLogsNamespace.on("connection", (socket) => {
			terminalService.streamTerminal(socket);
		});
	};
}
const socketIoServer = new SocketIoServer();
export default socketIoServer;

