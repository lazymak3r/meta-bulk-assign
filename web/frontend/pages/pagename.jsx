import {TitleBar} from "@shopify/app-bridge-react";
import {useTranslation} from "react-i18next";
import {LegacyCard, Page, Layout, VerticalStack, Text} from "@shopify/polaris";

export default function PageName() {
    const {t} = useTranslation();
    return (
        <Page>
            <TitleBar title={t("PageName.title")}>
                <button variant="primary" onClick={() => console.log("Primary action")}>
                    {t("PageName.primaryAction")}
                </button>
                <button onClick={() => console.log("Secondary action")}>
                    {t("PageName.secondaryAction")}
                </button>
            </TitleBar>
            <Layout>
                <Layout.Section>
                    <LegacyCard sectioned>
                        <Text variant="headingMd" as="h2">
                            {t("PageName.heading")}
                        </Text>
                        <VerticalStack>
                            <p>{t("PageName.body")}</p>
                        </VerticalStack>
                    </LegacyCard>
                    <LegacyCard sectioned>
                        <Text variant="headingMd" as="h2">
                            {t("PageName.heading")}
                        </Text>
                        <VerticalStack>
                            <p>{t("PageName.body")}</p>
                        </VerticalStack>
                    </LegacyCard>
                </Layout.Section>
                <Layout.Section secondary>
                    <LegacyCard sectioned>
                        <Text variant="headingMd" as="h2">
                            {t("PageName.heading")}
                        </Text>
                        <VerticalStack>
                            <p>{t("PageName.body")}</p>
                        </VerticalStack>
                    </LegacyCard>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
