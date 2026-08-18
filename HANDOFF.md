cd D:\hostel-management-software\apps\mobile

cd android; .\gradlew.bat assembleDebug --console=plain

adb install -r D:\hostel-management-software\apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk

adb reverse tcp:8081 tcp:8081

cd D:\hostel-management-software\apps\mobile; node_modules\.bin\expo start