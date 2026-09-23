import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";

type Props = {
  injectedJavaScript?: string;
  onLoadEnd?: () => void;
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  source: { html: string } | { uri: string };
  style?: StyleProp<ViewStyle>;
};

/**
 * `react-native-webview` for the installable web app, which it has no web
 * build for. `metro.config.js` swaps it in for the web bundle only.
 *
 * Every WebView in the app renders a page we wrote (the Leaflet maps, the PDF
 * receipt viewer), so an `srcdoc` iframe carries it: same-origin, which lets
 * `injectJavaScript` evaluate inside it, and a `window.ReactNativeWebView`
 * defined ahead of the page's own scripts that posts back to `onMessage`.
 */
export const WebView = forwardRef<{ injectJavaScript(code: string): void }, Props>(
  function WebView({ injectedJavaScript, onLoadEnd, onMessage, source, style }, ref) {
    const frame = useRef<HTMLIFrameElement | null>(null);

    useImperativeHandle(ref, () => ({
      injectJavaScript: (code) =>
        (frame.current?.contentWindow as (Window & { eval(code: string): unknown }) | null)?.eval(
          code,
        ),
    }));

    useEffect(() => {
      function listen(event: MessageEvent) {
        if (event.source === frame.current?.contentWindow && event.data?.rnWebView !== undefined) {
          onMessage?.({ nativeEvent: { data: String(event.data.rnWebView) } });
        }
      }

      window.addEventListener("message", listen);
      return () => window.removeEventListener("message", listen);
    }, [onMessage]);

    const bridge = `<script>window.ReactNativeWebView={postMessage:function(d){parent.postMessage({rnWebView:String(d)},"*")}};</script>`;
    const after = injectedJavaScript ? `<script>${injectedJavaScript}</script>` : "";
    const srcDoc =
      "html" in source
        ? /<head[^>]*>/i.test(source.html)
          ? source.html.replace(/<head[^>]*>/i, (head) => head + bridge) + after
          : bridge + source.html + after
        : undefined;

    return (
      <View style={[{ flex: 1, overflow: "hidden" }, style]}>
        <iframe
          onLoad={onLoadEnd}
          ref={frame}
          src={"uri" in source ? source.uri : undefined}
          srcDoc={srcDoc}
          style={{ border: 0, height: "100%", width: "100%" }}
        />
      </View>
    );
  },
);

export default WebView;
