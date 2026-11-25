[app]

# (str) Title of your application
title = Trader Skill AI

# (str) Package name
package.name = traderskillai

# (str) Package domain (needed for android/ios packaging)
package.domain = org.hassan.traderskillai

# (str) Source code where the main.py live
source.dir = .

# (list) Source files to include (let empty to include all the files)
source.include_exts = py,png,jpg,jpeg,kv,atlas,json

# (str) Application versioning (method 1)
version = 1.0.0

# (list) Application requirements
# comma separated e.g. requirements = sqlite3,kivy
requirements = python3,flet,aiohttp,websockets,certifi,idna,charset-normalizer,multidict,yarl,async-timeout,aiosignal,frozenlist,attrs

# (str) Presplash of the application
#presplash.filename = %(source.dir)s/presplash.png

# (str) Icon of the application
#icon.filename = %(source.dir)s/icon.png

# (list) Supported orientations
# (one of landscape, sensorLandscape, portrait or all)
orientation = portrait

# (list) List of service to declare
#services = NAME:ENTRYPOINT_TO_PY

#
# Android specific
#

# (bool) Indicate if the application should be fullscreen or not
fullscreen = 0

# (list) Permissions
android.permissions = INTERNET,ACCESS_NETWORK_STATE

# (int) Target Android API, should be as high as possible.
android.api = 33

# (int) Minimum API your APK will support.
android.minapi = 24

# (str) Android NDK version to use
android.ndk = 25b

# (bool) Use --private data storage (True) or --dir public storage (False)
android.private_storage = True

# (str) Android entry point, default is ok for Kivy-based app
#android.entrypoint = org.kivy.android.PythonActivity

# (list) Android additional libraries to copy into libs/armeabi-v7a
#android.add_libs_armeabi_v7a = libs/android/*.so

# (list) List of Java .jar files to add to the libs so that they can be included in the application.
#android.add_jars = foo.jar,bar.jar

# (list) List of Java files to add to the android project (can be referenced from the manifest)
#android.add_src =

# (list) Android application meta-data to set (key=value format)
#android.meta_data =

# (list) Android library project to add (will be added in the
# project.properties automatically.)
#android.add_aars =

# (list) Gradle dependencies to add
#android.gradle_dependencies =

# (bool) Copy library instead of making a link to it
#android.copy_libs = 1

# (list) The Android archs to build for, choices: armeabi-v7a, arm64-v8a, x86, x86_64
android.archs = arm64-v8a

# (bool) enables Android auto backup feature (Android API >=23)
android.allow_backup = True

# (str) XML file for custom backup rules (see android.allow_backup)
#android.backup_rules =

# (str) if you need to struggle with Android manifest overrides
#android.manifest.custom_xml =

# (str) Python for android branch to use, defaults to master
p4a.branch = master

# (str) python-for-android git clone directory (if empty, it will be automatically cloned from github)
#p4a.source_dir =

# (str) The directory in which python-for-android should look for your own build recipes (if empty, it will be automatically cloned from github)
#p4a.local_recipes =

# (str) Filename to the hook for p4a
#p4a.hook =

# (str) Bootstrap to use for android projects
#p4a.bootstrap = sdl2

# (int) port number to specify an action to run once building is completed
#android.copy_libs = 1


[buildozer]

# (int) Log level (0 = error only, 1 = info, 2 = debug (with command output))
log_level = 2

# (int) Display warning if buildozer is run as root (0 = no, 1 = yes)
warn_on_root = 1

# (str) Path to build artifact storage, relative to src
#build_dir = ./.buildozer

# (str) Path to build output (i.e. .apk, .aab) storage
#bin_dir = ./bin
