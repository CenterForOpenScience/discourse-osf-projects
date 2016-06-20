# name: discourse-osf-integration
# about: An integration plug-in for the Open Science Framework
# version: 0.0.1
# authors: Center for Open Science
enabled_site_setting :osf_integration_enabled

after_initialize do
    module ::OsfIntegration
        PROJECT_GUID_FIELD_NAME = "project_guid"
        TOPIC_GUID_FIELD_NAME = "topic_guid"

        class Engine < ::Rails::Engine
            engine_name "osf_integration"
            isolate_namespace OsfIntegration
        end
    end

    require_dependency 'application_controller'

    #class OsfIntegration::OsfController < ::ApplicationController

    #end

    on(:topic_created) do |topic, params, user|
      #guardian = Guardian.new(user)
       # Only staff can edit guid attributes
      return unless user.try(:staff?)

      topic.custom_fields.update(::DiscourseTagging.PROJECT_GUID_FIELD_NAME => params[:project_guid])
      topic.custom_fields.update(::DiscourseTagging.TOPIC_GUID_FIELD_NAME => params[:topic_guid])
      topic.save
    end
end
