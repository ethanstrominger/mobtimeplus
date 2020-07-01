/* globals grecaptcha */
/* eslint-disable import/no-absolute-path, import/extensions, import/no-unresolved */

import api from '/api.js';
import Status from '/status.js';

const TimerFX = (dispatch, { timerStartedAt, timerDuration, actions }) => {
  let cancel = false;
  let handle = null;

  const tick = () => {
    if (cancel) return undefined;

    const now = Date.now();
    const elapsed = now - timerStartedAt;
    const remaining = Math.max(0, timerDuration - elapsed);

    if (remaining === 0) {
      return dispatch(actions.Completed);
    }

    dispatch(actions.SetRemainingTime, remaining);

    handle = setTimeout(tick, 100);

    return undefined;
  };

  if (timerStartedAt) {
    handle = setTimeout(tick, 0);
  }

  return () => {
    cancel = true;
    clearTimeout(handle);
  };
};
export const Timer = (props) => [TimerFX, props];

const KeepAliveFX = (_dispatch, { token }) => {
  let cancel = false;
  let handle = null;

  const checkConnection = () => (cancel
    ? null
    : api('/api/ping', token)
      .then((r) => {
        if (!r.ok) {
          const error = new Error(`HTTP Status ${r.status}: ${r.statusText}`);
          error.response = r;
          throw error;
        }
        handle = setTimeout(checkConnection, 5 * 60 * 1000);
      })
      .catch((err) => {
        console.warn('Unable to ping timer', err); // eslint-disable-line no-console
      }));

  requestAnimationFrame(checkConnection);

  return () => {
    cancel = true;
    clearTimeout(handle);
  };
};
export const KeepAlive = (props) => [KeepAliveFX, props];


const WebsocketFX = (dispatch, { timerId, actions }) => {
  const protocol = window.location.protocol === 'https:'
    ? 'wss'
    : 'ws';
  const getAddress = (recaptchaToken) => (
    `${protocol}://${window.location.hostname}:${window.location.port}/${recaptchaToken}/${timerId}`
  );

  let socket = null;
  let cancel = false;
  let pingHandle = null;

  const getToken = () => new Promise((resolve, reject) => {
    try {
      grecaptcha
        .ready(() => grecaptcha
          .execute(
            window.RECAPTCHA_PUBLIC,
            { action: 'connection' },
          )
          .then(resolve));
    } catch (err) {
      reject(err);
    }
  });

  const connect = async () => {
    clearTimeout(pingHandle);
    if (cancel) return;

    const recaptchaToken = await getToken();

    socket = new WebSocket(getAddress(recaptchaToken));

    const ping = () => {
      if (cancel) return;
      socket.send(JSON.stringify({ ping: Date.now() }));
      pingHandle = setTimeout(ping, 1 * 60 * 1000);
    };

    dispatch(actions.SetStatus, Status.Connecting());
    const connectionAttempt = setTimeout(() => {
      console.log('Waited 10 seconds, no websocket response, closing connection attempt'); // eslint-disable-line no-console
      setTimeout(connect, 1000);
    }, 2000);

    socket.addEventListener('open', () => {
      clearTimeout(connectionAttempt);
      clearTimeout(pingHandle);

      socket.addEventListener('close', (event) => {
        console.log('socket closed');
        clearTimeout(pingHandle);
        dispatch(actions.SetStatus, Status.Error(event.reason || 'Disconnected by server'));
        socket = null;
        setTimeout(connect, 1000);
      });

      ping();
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);

      if (message.token) {
        dispatch(actions.SetToken, message.token);
      }

      if (message.type === 'notify') {
        dispatch(actions.ShowNotification, message.message);
      }

      dispatch(actions.Tick, message.state);
    });
  };

  requestAnimationFrame(connect);

  return () => {
    cancel = true;
    clearTimeout(pingHandle);
    socket.close();
    socket = null;
  };
};
export const Websocket = (props) => [WebsocketFX, props];


const DragAndDropFX = (dispatch, props) => {
  const onMove = (event) => {
    dispatch(props.DragMove, {
      clientX: event.pageX,
      clientY: event.pageY,
    });
  };

  const onMouseUp = (event) => {
    if (props.active) {
      event.preventDefault();
    }
    dispatch(props.DragEnd);
  };

  const onKeyUp = (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    dispatch(props.DragCancel);
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mouseup', onMouseUp);

  return () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keyup', onKeyUp);
  };
};
export const DragAndDrop = (props) => [DragAndDropFX, props];
