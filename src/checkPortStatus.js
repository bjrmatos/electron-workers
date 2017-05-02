
import { Socket } from 'net';

export default function(timeout, port, host, cb) {
  let connectionRefused = false,
      portStatus = null,
      error = null,
      socket;

  socket = new Socket();

  // Socket connection established, port is open
  socket.on('connect', () => {
    portStatus = 'open';
    socket.destroy();
  });

  // If no response, assume port is not listening
  socket.setTimeout(timeout);

  socket.on('timeout', () => {
    portStatus = 'closed';
    error = new Error(`Worker timeout (${timeout} ms) ocurred waiting for ${host}:${port} to be available`);
    socket.destroy();
  });

  socket.on('error', (exception) => {
    if (exception.code !== 'ECONNREFUSED') {
      error = exception;
    } else {
      connectionRefused = true;
    }

    portStatus = 'closed';
  });

  // Return after the socket has closed
  socket.on('close', (exception) => {
    if (exception && !connectionRefused) {
      error = exception;
    } else {
      error = null;
    }

    cb(error, portStatus);
  });

  socket.connect(port, host);
}
