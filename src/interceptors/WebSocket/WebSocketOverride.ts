import { invariant } from 'outvariant'
import type { WebSocketData } from './WebSocketTransport'
import { bindEvent } from './utils/bindEvent'
import { CloseEvent } from './utils/events'

type WebSocketEventListener = (this: WebSocket, event: Event) => void

export type WebSocketMessageListener = (
  this: WebSocket,
  event: MessageEvent
) => void

type WebSocketCloseListener = (this: WebSocket, event: CloseEvent) => void

const WEBSOCKET_CLOSE_CODE_RANGE_ERROR =
  'InvalidAccessError: close code out of user configurable range'

export const kOnSend = Symbol('kOnSend')
export const kClose = Symbol('kClose')

export class WebSocketOverride extends EventTarget implements WebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  public url: string
  public protocol: string
  public extensions: string
  public binaryType: BinaryType
  public readyState: number
  public bufferedAmount: number

  private _onopen: WebSocketEventListener | null = null
  private _onmessage: WebSocketMessageListener | null = null
  private _onerror: WebSocketEventListener | null = null
  private _onclose: WebSocketCloseListener | null = null

  private [kOnSend]?: (data: WebSocketData) => void

  constructor(url: string | URL, protocols?: string | Array<string>) {
    super()
    this.url = url.toString()
    this.protocol = ''
    this.extensions = ''
    this.binaryType = 'blob'
    this.readyState = this.CONNECTING
    this.bufferedAmount = 0

    Reflect.set(this, 'readyState', this.CONNECTING)
    queueMicrotask(() => {
      Reflect.set(this, 'readyState', this.OPEN)
      this.protocol = protocols ? protocols[0] : 'ws'

      this.dispatchEvent(bindEvent(this, new Event('open')))
    })
  }

  set onopen(listener: WebSocketEventListener | null) {
    this.removeEventListener('open', this._onopen)
    this._onopen = listener
    if (listener !== null) {
      this.addEventListener('open', listener)
    }
  }
  get onopen(): WebSocketEventListener | null {
    return this._onopen
  }

  set onmessage(listener: WebSocketMessageListener | null) {
    this.removeEventListener(
      'message',
      this._onmessage as WebSocketEventListener
    )
    this._onmessage = listener
    if (listener !== null) {
      this.addEventListener('message', listener)
    }
  }
  get onmessage(): WebSocketMessageListener | null {
    return this._onmessage
  }

  set onerror(listener: WebSocketEventListener | null) {
    this.removeEventListener('error', this._onerror)
    this._onerror = listener
    if (listener !== null) {
      this.addEventListener('error', listener)
    }
  }
  get onerror(): WebSocketEventListener | null {
    return this._onerror
  }

  set onclose(listener: WebSocketCloseListener | null) {
    this.removeEventListener('close', this._onclose as WebSocketEventListener)
    this._onclose = listener
    if (listener !== null) {
      this.addEventListener('close', listener)
    }
  }
  get onclose(): WebSocketCloseListener | null {
    return this._onclose
  }

  /**
   * @see https://websockets.spec.whatwg.org/#ref-for-dom-websocket-send%E2%91%A0
   */
  public send(data: WebSocketData): void {
    if (this.readyState === this.CONNECTING) {
      this.close()
      throw new DOMException('InvalidStateError')
    }

    // Sending when the socket is about to close
    // discards the sent data.
    if (this.readyState === this.CLOSING || this.readyState === this.CLOSED) {
      return
    }

    // Buffer the data to send in this even loop
    // but send it in the next.
    this.bufferedAmount += getDataSize(data)

    queueMicrotask(() => {
      // This is a bit optimistic but since no actual data transfer
      // is involved, all the data will be "sent" on the next tick.
      this.bufferedAmount = 0

      /**
       * @note Notify the parent about outgoing data.
       * This notifies the transport and the connection
       * listens to the outgoing data to emit the "message" event.
       */
      this[kOnSend]?.(data)
    })
  }

  public close(code: number = 1000, reason?: string): void {
    invariant(code, WEBSOCKET_CLOSE_CODE_RANGE_ERROR)
    invariant(
      code === 1000 || (code >= 3000 && code <= 4999),
      WEBSOCKET_CLOSE_CODE_RANGE_ERROR
    )

    if (this.readyState === this.CLOSING || this.readyState === this.CLOSED) {
      return
    }

    this[kClose](code, reason)
  }

  private [kClose](code: number = 1000, reason?: string): void {
    this.readyState = this.CLOSING

    queueMicrotask(() => {
      this.readyState = this.CLOSED

      // Non-user-configurable close status codes
      // represent connection termination and must
      // emit the "error" event before closing.
      if (code > 1000 && code <= 1015) {
        this.dispatchEvent(bindEvent(this, new Event('error')))
      }

      this.dispatchEvent(
        bindEvent(
          this,
          new CloseEvent('close', {
            code,
            reason,
            wasClean: code === 1000,
          })
        )
      )

      // Remove all event listeners once the socket is closed.
      this._onopen = null
      this._onmessage = null
      this._onerror = null
      this._onclose = null
    })
  }

  public addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, event: WebSocketEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void
  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void
  public addEventListener(
    type: unknown,
    listener: unknown,
    options?: unknown
  ): void {
    return super.addEventListener(
      type as string,
      listener as EventListener,
      options as AddEventListenerOptions
    )
  }

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    return super.removeEventListener(type, callback, options)
  }
}

function getDataSize(data: WebSocketData): number {
  if (typeof data === 'string') {
    return data.length
  }

  if (data instanceof Blob) {
    return data.size
  }

  return data.byteLength
}
