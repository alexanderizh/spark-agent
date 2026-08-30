# electron-builder's assisted installer appends APP_FILENAME to the directory
# selected by the user. Keep the product branding unchanged while installing
# the application under a dedicated spark-worker directory.
!ifdef APP_FILENAME
  !undef APP_FILENAME
!endif
!define APP_FILENAME "spark-worker"
