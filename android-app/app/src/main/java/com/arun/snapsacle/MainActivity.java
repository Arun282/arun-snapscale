package com.arun.snapsacle;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.graphics.Color;
public class MainActivity extends Activity {
    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        WebView w=new WebView(this);
        w.setBackgroundColor(Color.rgb(11,13,18));
        w.getSettings().setJavaScriptEnabled(true);
        w.getSettings().setDomStorageEnabled(true);
        w.setWebViewClient(new WebViewClient());
        w.loadUrl("file:///android_asset/index.html");
        setContentView(w);
    }
}
