# Ambiente do Android SDK e do JDK instalados na pasta pessoal (sem sudo).
# Uso: source scripts/android-env.sh
export JAVA_HOME="$HOME/jdk"
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
