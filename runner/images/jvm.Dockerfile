# Slice 3 runner proof: Java compile/run + google-java-format.
FROM eclipse-temurin:21-jdk

ARG GJF_VERSION=1.29.0
ADD https://github.com/google/google-java-format/releases/download/v${GJF_VERSION}/google-java-format-${GJF_VERSION}-all-deps.jar /opt/google-java-format.jar
RUN chmod 0444 /opt/google-java-format.jar

# google-java-format reflects into JDK internals; these opens are its documented
# requirement on modern JDKs, not a workaround we invented.
ENV GJF_CMD="java \
--add-exports jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED \
--add-exports jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED \
--add-exports jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED \
--add-exports jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED \
--add-exports jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED \
-jar /opt/google-java-format.jar"

RUN useradd --create-home --uid 10001 runner
USER runner
WORKDIR /w
