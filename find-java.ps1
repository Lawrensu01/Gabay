Write-Host "Searching for Java installations..." -ForegroundColor Cyan

# Common Java installation paths
$commonPaths = @(
    "C:\Program Files\Java\*",
    "C:\Program Files (x86)\Java\*",
    "$env:USERPROFILE\.jdks\*",
    "$env:LOCALAPPDATA\Programs\Eclipse Adoptium\*"
)

$javaInstalls = @()

foreach ($path in $commonPaths) {
    if (Test-Path $path) {
        $folders = Get-ChildItem -Path $path -Directory
        foreach ($folder in $folders) {
            if ($folder.Name -like "*jdk*" -or $folder.Name -like "*java*") {
                $javaExe = Join-Path $folder.FullName "bin\java.exe"
                if (Test-Path $javaExe) {
                    try {
                        $version = & $javaExe -version 2>&1
                        $versionText = $version -join " "
                        $javaInstalls += [PSCustomObject]@{
                            Path = $folder.FullName
                            Version = $versionText
                        }
                    }
                    catch {
                        Write-Host "Error checking Java version at $($folder.FullName): $_" -ForegroundColor Red
                    }
                }
            }
        }
    }
}

# Display Java installations
if ($javaInstalls.Count -eq 0) {
    Write-Host "No Java installations found! Please install JDK 17." -ForegroundColor Red
    Write-Host "You can download it from: https://adoptium.net/temurin/releases/?version=17" -ForegroundColor Yellow
    exit
}

Write-Host "`nFound Java installations:" -ForegroundColor Green
for ($i = 0; $i -lt $javaInstalls.Count; $i++) {
    $install = $javaInstalls[$i]
    Write-Host "[$i] $($install.Path)" -ForegroundColor White
    Write-Host "    $($install.Version)" -ForegroundColor Gray
}

# Let user select Java installation
$selection = -1
if ($javaInstalls.Count -gt 1) {
    Write-Host "`nPlease select a Java installation to use (or press Enter for the first one):" -ForegroundColor Cyan
    $input = Read-Host
    if ($input -eq "") {
        $selection = 0
    }
    else {
        try {
            $selection = [int]$input
            if ($selection -lt 0 -or $selection -ge $javaInstalls.Count) {
                $selection = 0
            }
        }
        catch {
            $selection = 0
        }
    }
}
else {
    $selection = 0
}

$selectedJava = $javaInstalls[$selection]
$escapedPath = $selectedJava.Path -replace '\\', '\\\\'
Write-Host "`nSelected: $($selectedJava.Path)" -ForegroundColor Green

# Update gradle.properties
$gradleProps = "android\gradle.properties"
if (Test-Path $gradleProps) {
    Write-Host "`nUpdating $gradleProps..." -ForegroundColor Cyan
    $content = Get-Content $gradleProps -Raw
    
    # Check if org.gradle.java.home is already set
    if ($content -match "org\.gradle\.java\.home=") {
        $content = $content -replace "org\.gradle\.java\.home=.*", "org.gradle.java.home=$escapedPath"
    }
    else {
        # Find the line with jvmargs
        if ($content -match "org\.gradle\.jvmargs=") {
            $content = $content -replace "(org\.gradle\.jvmargs=.*)", "`$1`n`n# Set Java 17 for Android Gradle Plugin`norg.gradle.java.home=$escapedPath"
        }
        else {
            $content += "`n`n# Set Java 17 for Android Gradle Plugin`norg.gradle.java.home=$escapedPath`n"
        }
    }
    
    $content | Set-Content $gradleProps -NoNewline
    Write-Host "Successfully updated gradle.properties!" -ForegroundColor Green
}
else {
    Write-Host "Could not find gradle.properties at $gradleProps!" -ForegroundColor Red
}

Write-Host "`nYou can now try building your app again." -ForegroundColor Cyan 