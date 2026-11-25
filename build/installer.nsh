; electron-builder inserts this include before its assisted installer and uninstaller templates.
!include "FileAssociation.nsh"
!define SATB_BUILD_RESOURCES "${__FILEDIR__}"

!define SATB_PROJECT_CLASS "SATBMaster.Project"

!macro customHeader
  !define /ifndef MUI_HEADERIMAGE_RIGHT
  BrandingText "SATB Master ${VERSION}"
  Caption "SATB Master 安装向导"
  UninstallCaption "SATB Master 卸载向导"
!macroend

!macro SatbWizardAppearance
  !ifndef SATB_LOCALIZED_NSIS_TEMPLATES
    !error "Build the SATB Master installer with npm run dist:win."
  !endif
  ; MUI reads these settings when addLangs runs, before electron-builder calls customHeader.
  !define /ifndef MUI_HEADERIMAGE_RIGHT
  !define MUI_ABORTWARNING
  !define MUI_UNABORTWARNING
  !define MUI_ABORTWARNING_CANCEL_DEFAULT
  !define MUI_UNABORTWARNING_CANCEL_DEFAULT
  !define MUI_ABORTWARNING_TEXT "确定退出 SATB Master 安装向导吗？"
  !define MUI_UNABORTWARNING_TEXT "确定退出 SATB Master 卸载向导吗？"
  !ifdef BUILD_UNINSTALLER
    !define /redef MUI_HEADERIMAGE_UNBITMAP "${SATB_BUILD_RESOURCES}\uninstaller-header.bmp"
    !define MUI_UNTEXT_UNINSTALLING_TITLE "正在卸载"
    !define MUI_UNTEXT_UNINSTALLING_SUBTITLE "正在移除 SATB Master，请稍候。"
    !define MUI_UNTEXT_FINISH_TITLE "卸载完成"
    !define MUI_UNTEXT_FINISH_SUBTITLE "SATB Master 卸载程序已完成。"
    !define MUI_UNTEXT_ABORT_TITLE "卸载已中止"
    !define MUI_UNTEXT_ABORT_SUBTITLE "SATB Master 卸载未完成。"
  !endif
!macroend

!macro SatbRemoveShortcut link
  ${If} ${FileExists} "${link}"
    WinShell::UninstShortcut "${link}"
    Delete "${link}"
  ${EndIf}
!macroend

!macro SatbRemoveAssociation
  !insertmacro APP_ASSOCIATE_GETFILECLASS $0 "satb"
  ${If} $0 == "${SATB_PROJECT_CLASS}"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.satb" ""
  ${EndIf}
  !insertmacro APP_UNASSOCIATE "satb" "${SATB_PROJECT_CLASS}"
!macroend

!ifndef BUILD_UNINSTALLER
  Var satbDesktop
  Var satbStartMenu
  Var satbAssociate
  Var satbOptionsScope
  Var satbDesktopBox
  Var satbStartMenuBox
  Var satbAssociateBox

  !macro SatbReadOption root option output
    ReadRegDWORD ${output} ${root} "${INSTALL_REGISTRY_KEY}" "${option}"
    ${If} ${output} == ""
      StrCpy ${output} ${BST_CHECKED}
    ${EndIf}
  !macroend

  !macro SatbReadOptions root
    !insertmacro SatbReadOption ${root} "CreateDesktopShortcut" $satbDesktop
    !insertmacro SatbReadOption ${root} "CreateStartMenuShortcut" $satbStartMenu
    !insertmacro SatbReadOption ${root} "AssociateSatbFile" $satbAssociate
  !macroend

  !macro customInit
    ${If} ${Silent}
      ; Silent upgrades select the machine install when one exists. Read before uninstallOldVersion.
      ${If} $hasPerMachineInstallation == "1"
        !insertmacro SatbReadOptions HKLM
      ${Else}
        !insertmacro SatbReadOptions SHELL_CONTEXT
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customWelcomePage
    !insertmacro SatbWizardAppearance
    !define MUI_WELCOMEPAGE_TITLE "欢迎安装 SATB Master ${VERSION}"
    !define MUI_WELCOMEPAGE_TITLE_3LINES
    !define MUI_WELCOMEPAGE_TEXT "SATB Master 是一款离线优先的四部和声学习、自动推导与实时记谱桌面软件。$\r$\n$\r$\n· 钢琴卷帘与自动笔刷$\r$\n· 70 条斯波索宾和声检查规则$\r$\n· 实时五线谱预览$\r$\n· 本地 SoundFont 音频回放$\r$\n$\r$\n单击「下一步」继续。"
    !insertmacro MUI_PAGE_WELCOME
    !define MUI_DIRECTORYPAGE_TEXT_TOP "请选择 SATB Master 的安装目录。单击「浏览」可选择其他位置。"
    !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "安装目录"
  !macroend

  !macro customPageAfterChangeDir
    PageEx custom
      PageCallbacks SatbInstallOptionsCreate SatbInstallOptionsLeave
      Caption " "
    PageExEnd

    Function SatbInstallOptionsCreate
      ${If} $satbOptionsScope != $installMode
        !insertmacro SatbReadOptions SHELL_CONTEXT
        StrCpy $satbOptionsScope $installMode
      ${EndIf}
      ${If} ${isUpdated}
        Abort
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "选择安装选项" "自定义快捷方式与 .satb 工程文件关联"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateCheckbox} 10u 10u 280u 18u "创建桌面快捷方式"
      Pop $satbDesktopBox
      ${NSD_SetState} $satbDesktopBox $satbDesktop
      ${NSD_CreateCheckbox} 10u 32u 280u 18u "创建开始菜单快捷方式"
      Pop $satbStartMenuBox
      ${NSD_SetState} $satbStartMenuBox $satbStartMenu
      ${NSD_CreateCheckbox} 10u 54u 280u 18u "关联 .satb 工程文件（双击可直接用 SATB Master 打开）"
      Pop $satbAssociateBox
      ${NSD_SetState} $satbAssociateBox $satbAssociate

      ${NSD_CreateLabel} 10u 91u 272u 32u "安装不会上传任何本地数据。后续卸载时可自由选择保留或清除配置与规则库。"
      Pop $0
      SetCtlColors $0 565B51 transparent
      nsDialogs::Show
    FunctionEnd

    Function SatbInstallOptionsLeave
      ${NSD_GetState} $satbDesktopBox $satbDesktop
      ${NSD_GetState} $satbStartMenuBox $satbStartMenu
      ${NSD_GetState} $satbAssociateBox $satbAssociate
    FunctionEnd
  !macroend

  !macro customFinishPage
    Function StartApp
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_TITLE "SATB Master 安装完成"
    !define MUI_FINISHPAGE_TEXT "SATB Master ${VERSION} 已安装到您的计算机。$\r$\n$\r$\n您可以立即启动软件，开始编辑四部和声工程。"
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "立即启动 SATB Master"
    !define MUI_FINISHPAGE_RUN_FUNCTION StartApp
    !insertmacro MUI_PAGE_FINISH
  !macroend

  !macro customInstall
    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "CreateDesktopShortcut" $satbDesktop
    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "CreateStartMenuShortcut" $satbStartMenu
    WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "AssociateSatbFile" $satbAssociate

    ${If} $satbDesktop == ${BST_CHECKED}
      ${If} $oldDesktopLink != $newDesktopLink
        !insertmacro SatbRemoveShortcut $oldDesktopLink
      ${EndIf}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "SATB Master"
      ${If} ${FileExists} "$newDesktopLink"
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${EndIf}
    ${Else}
      !insertmacro SatbRemoveShortcut $oldDesktopLink
    ${EndIf}

    StrCpy $launchLink "$appExe"
    ${If} $satbStartMenu == ${BST_CHECKED}
      ${If} $oldStartMenuLink != $newStartMenuLink
        !insertmacro SatbRemoveShortcut $oldStartMenuLink
        !insertmacro cleanupOldMenuDirectory
      ${EndIf}
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "SATB Master"
      ${If} ${FileExists} "$newStartMenuLink"
        WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
        StrCpy $launchLink "$newStartMenuLink"
      ${EndIf}
    ${Else}
      !insertmacro SatbRemoveShortcut $oldStartMenuLink
      ${If} $oldMenuDirectory != ""
        RMDir "$SMPROGRAMS\$oldMenuDirectory"
      ${EndIf}
    ${EndIf}

    ${If} $satbAssociate == ${BST_CHECKED}
      !insertmacro APP_ASSOCIATE "satb" "${SATB_PROJECT_CLASS}" "SATB Master 工程文件" \
        "$appExe,0" "用 SATB Master 打开" '$\"$appExe$\" $\"%1$\"'
    ${Else}
      !insertmacro SatbRemoveAssociation
    ${EndIf}
    !insertmacro UPDATEFILEASSOC
  !macroend
!else
  Var satbDeleteData
  Var satbDeleteDataButton
  Var satbUninstallSummary

  !macro customUnInit
    StrCpy $satbDeleteData ${BST_UNCHECKED}
    ${IfNot} ${isUpdated}
    ${AndIf} ${Silent}
    ${AndIf} ${isDeleteAppData}
      StrCpy $satbDeleteData ${BST_CHECKED}
    ${EndIf}
  !macroend

  !macro customUnWelcomePage
    !insertmacro SatbWizardAppearance
    !define MUI_WELCOMEPAGE_TITLE "卸载 SATB Master"
    !define MUI_WELCOMEPAGE_TEXT "此向导将从您的计算机中移除 SATB Master ${VERSION} 程序文件与快捷方式。$\r$\n$\r$\n当前安装目录：$\r$\n$INSTDIR$\r$\n$\r$\n如果软件仍在运行，确认后将自动关闭。"
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.UninstallOptionsCreate un.UninstallOptionsLeave

    Function un.UninstallOptionsCreate
      ${If} ${isUpdated}
      ${OrIf} ${Silent}
        Abort
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "选择本地数据处理方式" "决定是否保留您的设置、外置规则库与历史日志"
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateRadioButton} 10u 12u 275u 26u "保留本地配置、外置规则库、自动恢复记录与日志（推荐）"
      Pop $1
      ${NSD_AddStyle} $1 ${WS_GROUP}
      ${NSD_CreateRadioButton} 10u 42u 275u 26u "同时彻底清除应用本地配置、外置规则库、自动恢复记录与日志"
      Pop $satbDeleteDataButton
      ${If} $satbDeleteData == ${BST_CHECKED}
        ${NSD_Check} $satbDeleteDataButton
      ${Else}
        ${NSD_Check} $1
      ${EndIf}

      ${NSD_CreateLabel} 10u 85u 275u 54u "其他文件夹中的 .satb 工程会保留。彻底清除仅移除当前用户应用数据目录中的配置与缓存（%APPDATA%\SATB Master 和 %APPDATA%\satb-master）。"
      Pop $0
      SetCtlColors $0 565B51 transparent
      nsDialogs::Show
    FunctionEnd

    Function un.UninstallOptionsLeave
      ${NSD_GetState} $satbDeleteDataButton $satbDeleteData
    FunctionEnd
  !macroend

  !macro customUninstallPage
    !define MUI_FINISHPAGE_TITLE "SATB Master 卸载完成"
    !define MUI_FINISHPAGE_TEXT "$satbUninstallSummary"
  !macroend

  !macro customUnInstall
    ${IfNot} ${isKeepShortcuts}
      !insertmacro SatbRemoveShortcut $oldDesktopLink
      !insertmacro SatbRemoveShortcut $oldStartMenuLink
      ${If} $oldMenuDirectory != ""
        RMDir "$SMPROGRAMS\$oldMenuDirectory"
      ${EndIf}
    ${EndIf}

    !insertmacro SatbRemoveAssociation
    !insertmacro UPDATEFILEASSOC
  !macroend

  ; Expanded by the localized template after program files have been removed.
  !macro customRemoveAppData
    StrCpy $satbUninstallSummary "您的本地配置、外置规则库、自动恢复记录与日志已保留，重装后可继续使用。"
    ${If} $satbDeleteData == ${BST_CHECKED}
    ${AndIfNot} ${isUpdated}
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}
      StrCpy $R0 1
      ${If} ${UAC_IsInnerInstance}
        ; With a different administrator's credentials, use the original user's profile.
        !insertmacro UAC_AsUser_Call Function un.SatbRemoveCurrentUserData ${UAC_SYNCREGISTERS}
      ${Else}
        Call un.SatbRemoveCurrentUserData
      ${EndIf}
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}

      ${If} $R0 == 0
        StrCpy $satbUninstallSummary "程序文件及应用本地配置、外置规则库、自动恢复记录与日志均已清除。"
      ${Else}
        StrCpy $satbUninstallSummary "程序文件已移除，部分本地数据无法清除。请关闭占用这些文件的程序，然后在应用数据目录中检查剩余文件。"
        SetErrorLevel 1
      ${EndIf}
    ${EndIf}
  !macroend

  !macro SatbRemoveDataFolder name
    StrCpy $0 "$APPDATA\${name}"
    Call un.SatbRemoveDataDirectory
  !macroend

  ; Declared in the uninstaller template outside the uninstall section.
  !macro customUninstallFunctions
    Function un.SatbRemoveCurrentUserData
      StrCpy $R0 0
      ${If} $APPDATA == ""
        StrCpy $R0 1
        Return
      ${EndIf}
      !insertmacro SatbRemoveDataFolder "${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        !insertmacro SatbRemoveDataFolder "${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        !insertmacro SatbRemoveDataFolder "${APP_PACKAGE_NAME}"
      !endif
    FunctionEnd

    ; Do not follow junctions or directory symlinks under a writable user profile.
    Function un.SatbRemoveDataDirectory
      System::Call 'kernel32::GetFileAttributesW(w r0) i.r1 ?e'
      Pop $2
      ${If} $1 == -1
        ${If} $2 != 2
        ${AndIf} $2 != 3
          StrCpy $R0 1
        ${EndIf}
        Return
      ${EndIf}
      IntOp $2 $1 & 0x10
      ${If} $2 == 0
        StrCpy $R0 1
        Return
      ${EndIf}
      IntOp $2 $1 & 0x400
      ${If} $2 == 0
        FindFirst $3 $4 "$0\*"
        ${While} $4 != ""
          ${If} $4 != "."
          ${AndIf} $4 != ".."
            System::Call 'kernel32::GetFileAttributesW(w "$0\$4") i.r1'
            IntOp $2 $1 & 0x10
            ${If} $1 != -1
              ${If} $2 != 0
                Push $0
                Push $3
                Push $4
                StrCpy $0 "$0\$4"
                Call un.SatbRemoveDataDirectory
                Pop $4
                Pop $3
                Pop $0
              ${Else}
                Delete "$0\$4"
              ${EndIf}
            ${EndIf}
          ${EndIf}
          FindNext $3 $4
        ${EndWhile}
        FindClose $3
      ${EndIf}
      ClearErrors
      RMDir "$0"
      ${If} ${Errors}
        StrCpy $R0 1
      ${EndIf}
    FunctionEnd
  !macroend
!endif
