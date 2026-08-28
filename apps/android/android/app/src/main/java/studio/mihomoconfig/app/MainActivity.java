package studio.mihomoconfig.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
